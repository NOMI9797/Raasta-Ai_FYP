/**
 * LinkedIn Connection Acceptance Checker
 * 
 * Automatically checks LinkedIn connections page to detect accepted connection requests.
 * Matches connections with leads by username and updates status globally.
 */

import { testLinkedInSession, cleanupBrowserSession } from './linkedin-session-validator';
import { updateLeadStatus } from './lead-status-manager';
import { db } from './db';
import { leads, campaigns, messages } from './schema';
import { eq, and, or, inArray } from 'drizzle-orm';
import getRedisClient from './redis';
import { sendMessageToLead, randomDelay } from './linkedin-message-sender';
import { checkDailyMessageLimit, incrementMessageCounter } from './rate-limit-manager';

/**
 * Extract username from LinkedIn URL
 * @param {string} url - LinkedIn profile URL
 * @returns {string|null} - Username or null
 * 
 * Examples:
 * - "https://www.linkedin.com/in/azeem-sarwar-53a35b27a/" -> "azeem-sarwar-53a35b27a"
 * - "https://www.linkedin.com/in/azeem-sarwar-53a35b27a/?lipi=..." -> "azeem-sarwar-53a35b27a"
 */
export function extractUsernameFromUrl(url) {
  if (!url) return null;
  
  try {
    // Match pattern: /in/{username} (with or without trailing slash and query params)
    const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
    return match ? match[1].toLowerCase().trim() : null;
  } catch (error) {
    console.error('Error extracting username from URL:', error);
    return null;
  }
}

/**
 * Normalize LinkedIn URL for comparison
 * @param {string} url - LinkedIn profile URL
 * @returns {string} - Normalized URL
 */
export function normalizeLinkedInUrl(url) {
  if (!url) return '';
  
  try {
    // Extract username and build canonical URL
    const username = extractUsernameFromUrl(url);
    return username ? `https://www.linkedin.com/in/${username}/` : url.toLowerCase().trim();
  } catch (error) {
    console.error('Error normalizing URL:', error);
    return url.toLowerCase().trim();
  }
}

/**
 * Scrape connections page and load connections dynamically
 * @param {Page} page - Playwright page object
 * @param {number} targetCount - Target number of connections to load
 * @returns {Promise<Array<string>>} - Array of connection profile URLs
 */
export async function scrapeConnectionsPage(page, targetCount = 50) {
  console.log(`🔍 Scraping connections page, target: ${targetCount} connections`);
  
  try {
    // Navigate to connections page
    console.log('📍 Navigating to connections page...');
    await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait for page to stabilize
    await page.waitForTimeout(3000);
    
    // Wait for connections to load
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
    
    let connectionUrls = new Set();
    let noNewConnectionsCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 20; // Prevent infinite scrolling
    
    console.log('🔄 Starting to load connections...');
    
    while (connectionUrls.size < targetCount && scrollAttempts < maxScrollAttempts) {
      // Extract connection URLs from current page state
      const currentUrls = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
        return links
          .map(link => link.href)
          .filter(href => href.includes('/in/') && !href.includes('/company/'))
          .filter((href, index, self) => self.indexOf(href) === index); // Deduplicate
      });
      
      const previousCount = connectionUrls.size;
      currentUrls.forEach(url => connectionUrls.add(url));
      const newCount = connectionUrls.size;
      
      console.log(`📊 Loaded ${newCount} unique connections (${newCount - previousCount} new)`);
      
      // Check if we got new connections
      if (newCount === previousCount) {
        noNewConnectionsCount++;
        console.log(`⚠️ No new connections loaded (${noNewConnectionsCount}/3)`);
        
        if (noNewConnectionsCount >= 3) {
          console.log('🛑 No more connections available, stopping scroll');
          break;
        }
      } else {
        noNewConnectionsCount = 0; // Reset counter
      }
      
      // If we have enough connections, stop
      if (newCount >= targetCount) {
        console.log(`✅ Reached target: ${newCount} connections`);
        break;
      }
      
      // Scroll down to load more connections (human-like behavior)
      console.log('⬇️ Scrolling to load more connections...');
      await page.evaluate(() => {
        window.scrollBy({ 
          top: 800 + Math.random() * 400, // Random scroll distance (800-1200px)
          behavior: 'smooth' 
        });
      });
      
      // Random delay between scrolls (2-5 seconds) - anti-detection
      const scrollDelay = 2000 + Math.floor(Math.random() * 3000);
      console.log(`⏳ Waiting ${Math.floor(scrollDelay / 1000)}s before next scroll...`);
      await page.waitForTimeout(scrollDelay);
      
      scrollAttempts++;
    }
    
    console.log(`✅ Scraping complete: Found ${connectionUrls.size} unique connections`);
    return Array.from(connectionUrls);
    
  } catch (error) {
    console.error('❌ Error scraping connections page:', error);
    throw error;
  }
}

/**
 * Fetch all leads with sent invites for the user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - Array of leads with sent invites
 */
async function fetchLeadsWithSentInvites(userId) {
  try {
    console.log(`📥 Fetching leads for connection check (sent invites + accepted without messages)`);
    
    // Fetch leads that either:
    // 1. Have sent invites (status = 'sent') - check if accepted
    // 2. Are already accepted but haven't received messages yet
    const leadsToCheck = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.userId, userId),
          or(
            eq(leads.inviteStatus, 'sent'),  // Pending invites
            and(
              eq(leads.inviteStatus, 'accepted'),  // Already connected
              eq(leads.messageSent, false)  // But no message sent yet
            )
          )
        )
      );
    
    const sentCount = leadsToCheck.filter(l => l.inviteStatus === 'sent').length;
    const acceptedCount = leadsToCheck.filter(l => l.inviteStatus === 'accepted' && !l.messageSent).length;
    
    console.log(`✅ Found ${leadsToCheck.length} leads to check:`);
    console.log(`   - ${sentCount} with sent invites (check for acceptance)`);
    console.log(`   - ${acceptedCount} accepted but no message sent`);
    
    return leadsToCheck;
    
  } catch (error) {
    console.error('❌ Error fetching leads:', error);
    throw error;
  }
}

/**
 * Check connection acceptances for a LinkedIn account
 * Main orchestration function
 * 
 * @param {Object} accountData - LinkedIn account data from database
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Results object with matched/updated counts
 */
export async function checkConnectionAcceptances(accountData, userId) {
  let browserContext = null;
  let browserPage = null;
  
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 CONNECTION ACCEPTANCE CHECK`);
    console.log(`${'='.repeat(60)}`);
    console.log(`👤 Account: ${accountData.email}`);
    console.log(`🆔 User ID: ${userId}\n`);
    
    // STEP 1: Validate and open LinkedIn session
    console.log('🔐 STEP 1: Validating LinkedIn session...');
    const sessionCheck = await testLinkedInSession(accountData, true);
    
    if (!sessionCheck.isValid) {
      throw new Error(`Session invalid: ${sessionCheck.reason}`);
    }
    
    browserContext = sessionCheck.context;
    browserPage = sessionCheck.page;
    console.log('✅ Session validated successfully\n');
    
    // STEP 2: Fetch leads with sent invites
    console.log('📥 STEP 2: Fetching leads with sent invites...');
    const sentLeads = await fetchLeadsWithSentInvites(userId);
    
    if (sentLeads.length === 0) {
      console.log('⚠️ No leads with sent invites found');
      return {
        success: true,
        matched: 0,
        updated: 0,
        total: 0,
        message: 'No leads with sent invites to check'
      };
    }
    
    console.log(`✅ Found ${sentLeads.length} leads to check\n`);
    
    // STEP 3: Scrape connections page
    console.log('🌐 STEP 3: Scraping LinkedIn connections page...');
    // Load at least 100 connections to cover manual invites + app invites
    // LinkedIn shows newest connections first, so we want to check recent ones
    const targetCount = Math.max(sentLeads.length * 3, 100); // 3x buffer or minimum 100
    const connectionUrls = await scrapeConnectionsPage(browserPage, targetCount);
    
    if (connectionUrls.length === 0) {
      console.log('⚠️ No connections found on page');
      return {
        success: true,
        matched: 0,
        updated: 0,
        total: sentLeads.length,
        message: 'No connections found on connections page'
      };
    }
    
    console.log(`✅ Loaded ${connectionUrls.length} connections\n`);
    
    // STEP 4: Extract usernames from connections
    console.log('🔍 STEP 4: Extracting usernames from connections...');
    const connectionUsernames = new Set();
    
    connectionUrls.forEach(url => {
      const username = extractUsernameFromUrl(url);
      if (username) {
        connectionUsernames.add(username);
      }
    });
    
    console.log(`✅ Extracted ${connectionUsernames.size} unique usernames\n`);
    
    // STEP 5: Match leads with connections
    console.log('🔗 STEP 5: Matching leads with connections...');
    const matchedLeads = [];
    
    for (const lead of sentLeads) {
      const leadUsername = extractUsernameFromUrl(lead.url);
      
      if (leadUsername && connectionUsernames.has(leadUsername)) {
        console.log(`✅ MATCH: ${lead.name || 'Lead'} (${leadUsername})`);
        matchedLeads.push(lead);
      }
    }
    
    console.log(`\n📊 Matched ${matchedLeads.length}/${sentLeads.length} leads\n`);
    
    // STEP 6: Update matched leads in their respective campaigns
    if (matchedLeads.length > 0) {
      console.log('💾 STEP 6: Updating matched leads in their campaigns...');
      
      const updatePromises = matchedLeads.map(async (lead) => {
        try {
          // Update lead status in its specific campaign
          await updateLeadStatus(lead.campaignId, lead.id, 'accepted', true);
          
          // Also update inviteAcceptedAt timestamp in database
          await db.update(leads)
            .set({ 
              inviteAcceptedAt: new Date(),
              lastConnectionCheckAt: new Date()
            })
            .where(eq(leads.id, lead.id));
          
          console.log(`✅ Updated: ${lead.name || 'Lead'} in campaign ${lead.campaignId}`);
        } catch (error) {
          console.error(`❌ Failed to update lead ${lead.id}:`, error.message);
        }
      });
      
      await Promise.all(updatePromises);
      console.log(`✅ Successfully updated ${matchedLeads.length} leads in their campaigns\n`);
    }
    
    // STEP 7: Send messages to accepted connections (if they have generated messages)
    let messagesSent = 0;
    
    if (matchedLeads.length > 0) {
      console.log('📨 STEP 7: Sending messages to accepted connections...');
      
      // Check daily message limit
      const messageLimitCheck = await checkDailyMessageLimit(accountData.id);
      console.log(`📊 Daily message limit: ${messageLimitCheck.sent}/${messageLimitCheck.limit}`);
      console.log(`📊 Remaining messages today: ${messageLimitCheck.remaining}\n`);
      
      if (!messageLimitCheck.canSend) {
        console.log('⚠️ Daily message limit reached. Skipping message sending.\n');
      } else {
        // Get messages for matched leads
        const matchedLeadIds = matchedLeads.map(l => l.id);
        const leadMessages = await db
          .select()
          .from(messages)
          .where(inArray(messages.leadId, matchedLeadIds));
        
        console.log(`📝 Found ${leadMessages.length} generated messages for matched leads\n`);
        
        // Filter leads that: have message + message not sent yet
        const leadsToMessage = [];
        
        for (const lead of matchedLeads) {
          const leadMessage = leadMessages.find(m => m.leadId === lead.id);
          
          if (leadMessage && !lead.messageSent) {
            leadsToMessage.push({
              lead,
              message: leadMessage
            });
          }
        }
        
        console.log(`✅ ${leadsToMessage.length} leads eligible for messaging\n`);
        
        // Send messages (respecting daily limit)
        for (let i = 0; i < leadsToMessage.length; i++) {
          const { lead, message } = leadsToMessage[i];
          
          // Check if we've hit the limit
          const currentLimit = await checkDailyMessageLimit(accountData.id);
          if (!currentLimit.canSend) {
            console.log(`⚠️ Daily message limit reached after ${messagesSent} messages. Stopping.\n`);
            break;
          }
          
          console.log(`📤 Sending message ${i + 1}/${leadsToMessage.length} to: ${lead.name || 'Lead'}`);
          
          try {
            const result = await sendMessageToLead(
              browserPage,
              lead.url,
              message.content,
              lead.name || 'Lead'
            );
            
            if (result.success) {
              // Update lead message status in database
              await db.update(leads)
                .set({
                  messageSent: true,
                  messageSentAt: new Date(),
                  messageError: null
                })
                .where(eq(leads.id, lead.id));
              
              // Update message status in database
              await db.update(messages)
                .set({ 
                  status: 'sent',
                  sentAt: new Date()
                })
                .where(eq(messages.id, message.id));
              
              // Increment counter
              await incrementMessageCounter(accountData.id);
              
              messagesSent++;
              console.log(`✅ Message sent successfully (${messagesSent} total)\n`);
              
              // Random delay before next message (30-90 seconds)
              if (i < leadsToMessage.length - 1) {
                await randomDelay(30, 90);
              }
              
            } else {
              console.error(`❌ Failed to send message: ${result.error}`);
              // Update lead message error in database
              await db.update(leads)
                .set({
                  messageSent: false,
                  messageError: result.error
                })
                .where(eq(leads.id, lead.id));
            }
            
          } catch (error) {
            console.error(`❌ Error sending message to ${lead.name}:`, error.message);
            // Update lead message error in database
            await db.update(leads)
              .set({
                messageSent: false,
                messageError: error.message
              })
              .where(eq(leads.id, lead.id));
          }
        }
        
        console.log(`\n📊 Messages sent: ${messagesSent}/${leadsToMessage.length}\n`);
      }
    }
    
    // STEP 8: Update lastConnectionCheckAt for all checked leads
    console.log('💾 STEP 8: Updating check timestamp for all leads...');
    const leadIds = sentLeads.map(l => l.id);
    
    await db.update(leads)
      .set({ lastConnectionCheckAt: new Date() })
      .where(inArray(leads.id, leadIds));
    
    console.log('✅ Check timestamps updated\n');
    
    console.log(`${'='.repeat(60)}`);
    console.log(`🎉 CONNECTION CHECK COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 Total leads checked: ${sentLeads.length}`);
    console.log(`✅ Matched connections: ${matchedLeads.length}`);
    console.log(`🔄 Updated globally: ${matchedLeads.length}`);
    console.log(`📨 Messages sent: ${messagesSent}`);
    console.log(`${'='.repeat(60)}\n`);
    
    return {
      success: true,
      matched: matchedLeads.length,
      updated: matchedLeads.length,
      total: sentLeads.length,
      messagesSent: messagesSent,
      matchedLeads: matchedLeads.map(l => ({ id: l.id, name: l.name, url: l.url }))
    };
    
  } catch (error) {
    console.error('❌ Connection check failed:', error);
    throw error;
    
  } finally {
    // Always cleanup browser
    if (browserContext) {
      console.log('🔒 Closing browser...');
      await cleanupBrowserSession(browserContext);
      console.log('✅ Browser closed\n');
    }
  }
}

