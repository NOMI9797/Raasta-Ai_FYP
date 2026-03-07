import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads, posts, messages } from "@/libs/schema";
import { eq, desc, and } from "drizzle-orm";
import { generatePersonalizedMessageStream } from "@/libs/groq-service";
import { withAuth } from "@/libs/auth-middleware";

export const POST = withAuth(async (request, { user }) => {
  try {
    const { leadId, customPrompt, model } = await request.json();

    if (!leadId) {
      return NextResponse.json(
        { error: "Lead ID is required" },
        { status: 400 }
      );
    }

    // Get lead information (ensure user owns the lead)
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!lead) {
      return NextResponse.json(
        { error: "Lead not found" },
        { status: 404 }
      );
    }

    // Get posts for this lead (ensure user owns the posts)
    const leadPosts = await db
      .select()
      .from(posts)
      .where(and(eq(posts.leadId, leadId), eq(posts.userId, user.id)))
      .orderBy(desc(posts.engagement), desc(posts.timestamp))
      .limit(5);

    if (leadPosts.length === 0) {
      return NextResponse.json(
        { error: "No posts found for this lead. Please scrape the profile first." },
        { status: 400 }
      );
    }

    // Create a readable stream for the response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', message: 'Starting message generation...' })}\n\n`));

          let fullMessage = '';

          // Generate streaming message using Groq
          await generatePersonalizedMessageStream({
            leadName: lead.name || "LinkedIn User",
            leadTitle: lead.title,
            leadCompany: lead.company,
            posts: leadPosts.map(post => ({
              content: post.content,
              timestamp: post.timestamp.toISOString(),
              engagement: post.engagement
            })),
            customPrompt,
            model: model || "llama-3.1-8b-instant",
            onChunk: (chunk) => {
              fullMessage += chunk;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`));
            }
          });

          // Save message to database
          const [savedMessage] = await db
            .insert(messages)
            .values({
              userId: user.id,
              leadId: leadId,
              campaignId: lead.campaignId,
              content: fullMessage,
              model: model || "llama-3.1-8b-instant",
              customPrompt,
              postsAnalyzed: leadPosts.length,
              status: "draft",
            })
            .returning();

          // Send completion status
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'done', 
            messageId: savedMessage.id,
            fullMessage: fullMessage 
          })}\n\n`));

        } catch (error) {
          console.error('Streaming error:', error);
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: error.message 
          })}\n\n`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Generate stream error:', error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
