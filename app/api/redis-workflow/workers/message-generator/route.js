import { NextResponse } from "next/server";
import { RedisStreamManager } from "@/libs/redis";
import { generatePersonalizedMessage } from "@/libs/groq-service";
import { db } from "@/libs/db";
import { leads, messages } from "@/libs/schema";
import { eq, inArray } from "drizzle-orm";
import getRedisClient from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

/**
 * POST /api/redis-workflow/workers/message-generator
 * 
 * Redis-First: Message Generation Worker with Bulk DB Updates
 * 
 * This worker:
 * 1. Consumes leads from Redis stream for a specific campaign
 * 2. Generates AI messages
 * 3. Updates Redis cache FIRST (immediate availability)
 * 4. Performs bulk DB updates SECOND (persistence)
 * 5. Updates campaign metadata
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const streamManager = new RedisStreamManager();
    const redis = getRedisClient();
    
    const CONSUMER_GROUP_NAME = 'message-generators';
    const CONSUMER_NAME = process.env.WORKER_ID || 'default-worker';

    const { batchSize = 5, consumerName = CONSUMER_NAME, campaignId } = await request.json();

    if (!campaignId) {
      return NextResponse.json({
        error: "Campaign ID is required for message generation",
        success: false
      }, { status: 400 });
    }

    // Process only the specific campaign stream
    const streamName = `campaign:${campaignId}:message-generation`;
    
    // Check if stream exists
    const streamExists = await redis.exists(streamName);
    if (!streamExists) {
      return NextResponse.json({
        success: true,
        message: `No message generation stream found for campaign ${campaignId}`,
        data: {
          processed: 0,
          failed: 0,
          total: 0,
          results: [],
          consumerName,
          campaignId,
          workflow: "redis-first-campaign-specific"
        }
      });
    }

    // Process the specific campaign stream
    try {
      await streamManager.createConsumerGroup(streamName, CONSUMER_GROUP_NAME);
      
      const streamResult = await streamManager.readFromStream(
        streamName,
        CONSUMER_GROUP_NAME,
        consumerName,
        batchSize
      );

      if (!streamResult || streamResult.length === 0) {
        // No messages in this stream
        return NextResponse.json({
          success: true,
          message: `No messages found in stream for campaign ${campaignId}`,
          data: {
            processed: 0,
            failed: 0,
            total: 0,
            results: [],
            consumerName,
            campaignId,
            workflow: "redis-first-campaign-specific"
          }
        });
      }

      const consumedMessages = streamResult[0][1]; // Get messages from stream
      console.log(`🔄 Processing ${consumedMessages.length} messages from campaign ${campaignId}`);

      let processedCount = 0;
      let failedCount = 0;
      const results = [];
      const messagesToInsert = [];
      const leadIdsToUpdate = [];

      // Process each message
      for (const [messageId, fields] of consumedMessages) {
        try {
          // Convert Redis stream fields array to object
          const leadData = {};
          for (let i = 0; i < fields.length; i += 2) {
            leadData[fields[i]] = fields[i + 1];
          }

          console.log(`🤖 Generating message for lead ${leadData.lead_id} in campaign ${campaignId}`);

          // Generate AI message
          const aiMessage = await generatePersonalizedMessage({
            leadName: leadData.name || "LinkedIn User",
            leadTitle: leadData.title || "",
            leadCompany: leadData.company || "",
            posts: [],
            customPrompt: leadData.custom_prompt || "",
            model: leadData.model || "llama-3.1-8b-instant"
          });

          // Prepare message for bulk insert
          messagesToInsert.push({
            leadId: leadData.lead_id,
            campaignId: leadData.campaign_id,
            userId: user.id, // Add the authenticated user ID
            content: aiMessage,
            model: leadData.model || "llama-3.1-8b-instant",
            customPrompt: leadData.custom_prompt || "",
            status: 'draft'
          });

          leadIdsToUpdate.push(leadData.lead_id);

          // Acknowledge message in Redis
          await streamManager.acknowledgeMessage(streamName, CONSUMER_GROUP_NAME, messageId);

          console.log(`✅ Message generated successfully for lead ${leadData.lead_id}`);

          results.push({
            success: true,
            leadId: leadData.lead_id,
            campaignId: leadData.campaign_id,
            redisMessageId: messageId,
            streamName: streamName
          });

          processedCount++;

        } catch (error) {
          console.error(`❌ Failed to process message ${messageId}:`, error);
          failedCount++;
          results.push({
            success: false,
            messageId,
            error: error.message,
            streamName: streamName
          });
        }
      }

      // Redis-First: Update Redis cache immediately, then database
      if (messagesToInsert.length > 0) {
        try {
          // 1. REDIS FIRST: Update Redis message cache immediately
          const messagesData = {};
          messagesToInsert.forEach(message => {
            messagesData[message.leadId] = JSON.stringify({
              id: message.id || `temp-${Date.now()}-${message.leadId}`, // Use temp ID if not available
              leadId: message.leadId,
              campaignId: message.campaignId,
              userId: message.userId, // Include userId for consistency
              content: message.content,
              model: message.model,
              customPrompt: message.customPrompt,
              status: message.status,
              createdAt: new Date().toISOString()
            });
          });
          
          await redis.hset(`campaign:${campaignId}:messages`, messagesData);
          console.log(`🚀 REDIS-FIRST: Updated Redis message cache with ${messagesToInsert.length} new messages for campaign ${campaignId}`);
          
          // 2. DATABASE SECOND: Insert to database after Redis update
          await db.insert(messages).values(messagesToInsert);
          console.log(`💾 DATABASE: Inserted ${messagesToInsert.length} messages to database for campaign ${campaignId}`);
          
        } catch (error) {
          console.error(`❌ Redis-First: Failed to update cache or database for campaign ${campaignId}:`, error);
        }
      }

      // Update Redis cache for the campaign
      if (processedCount > 0) {
        try {
          // Update campaign data timestamp and message count
          const currentData = await redis.hgetall(`campaign:${campaignId}:data`);
          if (currentData && currentData.leadsCount) {
            const currentMessagesCount = parseInt(currentData.messagesCount) || 0;
            await redis.hset(`campaign:${campaignId}:data`, {
              'lastUpdated': Date.now(),
              'messagesCount': currentMessagesCount + processedCount
            });
            console.log(`🔄 Updated cache timestamp and message count for campaign ${campaignId}`);
          }
        } catch (error) {
          console.log(`⚠️ Cache update error for campaign ${campaignId}:`, error.message);
        }
      }

      console.log(`🎉 Campaign ${campaignId} processing completed: ${processedCount} processed, ${failedCount} failed`);

      return NextResponse.json({
        success: true,
        message: `Processed ${processedCount} messages successfully for campaign ${campaignId}`,
        data: {
          processed: processedCount,
          failed: failedCount,
          total: processedCount + failedCount,
          results: results,
          consumerName,
          campaignId,
          workflow: "redis-first-campaign-specific"
        }
      });

    } catch (error) {
      console.error(`❌ Error processing campaign ${campaignId}:`, error);
      return NextResponse.json({
        success: false,
        error: `Failed to process campaign ${campaignId}: ${error.message}`,
        data: {
          processed: 0,
          failed: 1,
          total: 1,
          results: [{
            success: false,
            error: error.message,
            campaignId
          }],
          consumerName,
          campaignId,
          workflow: "redis-first-campaign-specific"
        }
      }, { status: 500 });
    }

  } catch (error) {
    console.error("❌ Worker error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});