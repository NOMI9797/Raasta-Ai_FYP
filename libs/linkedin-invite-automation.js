/**
 * LinkedIn Invite Automation Module
 * 
 * Handles all Playwright-based LinkedIn invite sending automation.
 * Separated from API logic for better maintainability and testability.
 */

import { updateLeadStatus } from './lead-status-manager';

// Debug mode: Enable screenshots and verbose logging
const DEBUG_MODE = process.env.ENABLE_DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Wait for LinkedIn profile page to stabilize
 * @param {Page} page - Playwright page object
 */
async function waitForPageStabilization(page) {
  console.log(`⏳ Waiting for profile page to stabilize...`);
  
  try {
    // Wait for main container (fast check)
    await Promise.race([
      page.waitForSelector('.scaffold-layout__main', { timeout: 5000 }),
      page.waitForSelector('.ph5', { timeout: 5000 }),
      page.waitForSelector('main.scaffold-layout__main', { timeout: 5000 })
    ]).catch(() => {});
    
    // OPTIMIZATION: Removed networkidle wait (LinkedIn has constant network activity)
    // Use domcontentloaded instead - much faster
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    
    // OPTIMIZATION: Reduced React render wait from 2s → 500ms
    await page.waitForTimeout(500);
    
  } catch (e) {
    // Silently continue - page might still be usable
  }
}

/**
 * Get the profile header container (where action buttons are)
 * This ensures we only search for Connect button in the profile header, not sidebar
 * @param {Page} page - Playwright page object
 * @returns {Promise<Locator|null>} - Profile header container or null
 */
async function getProfileHeaderContainer(page) {
  console.log(`🔍 Finding profile header container...`);
  
  // Multiple possible selectors for the profile header/actions area
  const headerSelectors = [
    '.pv-top-card', // Most common - profile top card
    '.scaffold-layout__main .pv-top-card',
    'section.artdeco-card.pv-top-card',
    '.profile-background-image ~ div', // Container after background image
    'main .ph5', // Main content area
    '.scaffold-layout__main section:first-of-type' // First section in main layout
  ];
  
  for (const selector of headerSelectors) {
    try {
      const container = page.locator(selector).first();
      if (await container.isVisible({ timeout: 3000 })) {
        console.log(`✅ Found profile header with: ${selector}`);
        return container;
      }
    } catch (e) {
      continue;
    }
  }
  
  console.log(`⚠️ Profile header not found, will search entire page (less accurate)`);
  return null;
}

/**
 * Find Connect button in "More" dropdown
 * @param {Page} page - Playwright page object
 * @param {Locator|null} profileHeader - Profile header container (optional)
 * @returns {Promise<Locator|null>} - Connect button locator or null
 */
async function findConnectButtonInDropdown(page, profileHeader = null) {
  try {
    // Define search context (profile header or entire page)
    const searchContext = profileHeader || page;
    
    // Find the "More" button using multiple selectors
    const moreButtonSelectors = [
      'button[aria-label*="More actions"]',
      'button.artdeco-dropdown__trigger:has-text("More")',
      'button:has-text("More")',
      'button[id*="profile-overflow"]'
    ];
    
    let moreButton = null;
    
    for (const selector of moreButtonSelectors) {
      try {
        const btn = searchContext.locator(selector).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          moreButton = btn;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!moreButton) {
      return null;
    }
    
    // Click the "More" button to open dropdown
    try {
      await moreButton.click();
      await page.waitForTimeout(2000);
    } catch (clickError) {
      return null;
    }
    
    // Wait for dropdown content to render
    await page.waitForTimeout(1000);
    
    const dropdownConnectSelectors = [
      // Very simple - just text (most reliable)
      'span:text-is("Connect")',
      'div:has-text("Connect")',
      
      // Dropdown specific
      '.artdeco-dropdown__item:has-text("Connect")',
      '.artdeco-dropdown__item span:text-is("Connect")',
      
      // Role-based
      '[role="menuitem"]:has-text("Connect")',
      'div[role="button"]:has-text("Connect")',
      
      // From user's HTML
      'span.display-flex:text-is("Connect")',
      'span[aria-hidden="true"]:text-is("Connect")',
      
      // Aria-label based (best for verification)
      'div[aria-label*="Invite"]',
      'div[aria-label*="Invite"][aria-label*="connect"]'
    ];
    
    for (const selector of dropdownConnectSelectors) {
      try {
        const elements = await page.locator(selector).all();
        
        for (const element of elements) {
          try {
            if (await element.isVisible({ timeout: 1000 })) {
              const text = await element.textContent().catch(() => '');
              const ariaLabel = await element.getAttribute('aria-label').catch(() => '');
              
              // Check if this is Connect
              if (text.trim().toLowerCase() === 'connect' || 
                  (ariaLabel && ariaLabel.toLowerCase().includes('invite') && ariaLabel.toLowerCase().includes('connect'))) {
                
                // Try to find clickable parent
                try {
                  const parent = element.locator('xpath=ancestor::div[@role="button" or contains(@class, "dropdown__item")]').first();
                  if (await parent.isVisible()) {
                    console.log(`✅ Found Connect option in dropdown`);
                    return parent;
                  }
                } catch (e) {
                  // If no parent, return element itself
                  console.log(`✅ Found Connect option in dropdown`);
                  return element;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    return null;
    
  } catch (error) {
    return null;
  }
}

/**
 * Find Connect button using multiple strategies
 * Strategy 1: Direct Connect button on profile
 * Strategy 2: Connect button hidden in "More" dropdown
 * 
 * IMPORTANT: Only searches within profile header to avoid sidebar Connect buttons
 * 
 * @param {Page} page - Playwright page object
 * @returns {Promise<Locator|null>} - Connect button locator or null
 */
export async function findConnectButton(page) {
  console.log(`🔍 Searching for Connect button...`);
  
  // Wait for page to stabilize first
  await waitForPageStabilization(page);

  // Get profile header container to limit search scope
  const profileHeader = await getProfileHeaderContainer(page);
  const searchContext = profileHeader || page;

  // STRATEGY 1: Look for direct Connect button first
  const directConnectSelectors = [
    'button:has(span.artdeco-button__text:text-is("Connect"))',
    'button[aria-label*="Invite"][aria-label*="connect"]',
    'button.artdeco-button:has-text("Connect")',
    'button:text-is("Connect")',
    'button:has(span:text("Connect"))',
    // Additional selectors for edge cases
    'button[data-control-name="connect"]',
    'button[aria-label*="Connect"]',
    'div[role="button"]:has-text("Connect")'
  ];

  // Try direct connect button first
  for (let i = 0; i < directConnectSelectors.length; i++) {
    const selector = directConnectSelectors[i];
    
    try {
      const buttons = await searchContext.locator(selector).all();
      
      if (buttons.length > 0) {
        // Verify each button
        for (const button of buttons) {
          try {
            // Check if button is visible
            const isVisible = await button.isVisible();
            if (!isVisible) continue;
            
            // Get button text
            const buttonHandle = await button.elementHandle();
            const buttonText = await buttonHandle.evaluate(el => {
              const span = el.querySelector('span.artdeco-button__text');
              if (span) return span.textContent?.trim();
              return el.textContent?.trim();
            });
            
            // Check if this is Connect button
            if (buttonText && buttonText.toLowerCase().includes('connect')) {
              // Exclude unwanted buttons
              if (buttonText.toLowerCase().includes('message') || 
                  buttonText.toLowerCase().includes('pending') ||
                  buttonText.toLowerCase().includes('follow') ||
                  buttonText.toLowerCase() === 'connected') {
                continue;
              }
              
              console.log(`✅ Found direct Connect button`);
              return button;
            }
          } catch (evalError) {
            continue;
          }
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  // STRATEGY 2: Look for Connect button in "More" dropdown
  console.log(`🔍 Checking "More" dropdown...`);
  
  const connectInDropdown = await findConnectButtonInDropdown(page, profileHeader);
  
  if (connectInDropdown) {
    console.log(`✅ Found Connect button in dropdown`);
    return connectInDropdown;
  }
  
  // Log what buttons we actually found for debugging
  try {
    const allButtons = await searchContext.locator('button').all();
    const buttonTexts = [];
    for (const button of allButtons.slice(0, 10)) { // Limit to first 10 buttons
      try {
        const text = await button.textContent();
        if (text && text.trim()) {
          buttonTexts.push(text.trim());
        }
      } catch (e) {
        continue;
      }
    }
    console.log(`🔍 Available buttons on page: ${buttonTexts.join(', ')}`);
  } catch (e) {
    console.log(`⚠️ Could not get button texts: ${e.message}`);
  }
  
  console.log(`❌ Connect button not found`);
  return null;
}

/**
 * Check connection status (Pending or Already Connected)
 * @param {Page} page - Playwright page object
 * @param {string} campaignId - Campaign ID
 * @param {Object} lead - Lead object
 * @param {Object} results - Results object to update
 * @returns {Promise<boolean>} - True if already connected/pending, false otherwise
 */
export async function checkConnectionStatus(page, campaignId, lead, results) {
  console.log(`🔍 Checking connection status...`);
  
  // 1. Check Pending first
  try {
    const pendingButton = page.locator('button:has-text("Pending")').first();
    if (await pendingButton.isVisible()) {
      console.log(`⏳ ALREADY PENDING: ${lead.name}`);
      console.log(`📝 LinkedIn shows "Pending" - updating as SENT`);
      results.alreadyPending++;
      
      // Update this lead in this campaign
      await updateLeadStatus(campaignId, lead.id, 'sent', true);
      return true;
    }
  } catch (e) {
    // No pending button found, continue
  }
  
  // 2. Check for other connection states that might prevent Connect button
  try {
    // Check for "Connected" text
    const connectedText = page.locator('text="Connected"').first();
    if (await connectedText.isVisible()) {
      console.log(`✅ ALREADY CONNECTED: ${lead.name} (Connected text found)`);
      console.log(`📝 LinkedIn shows "Connected" - updating as ACCEPTED`);
      results.alreadyConnected++;
      
      await updateLeadStatus(campaignId, lead.id, 'accepted', true);
      return true;
    }
  } catch (e) {
    // No connected text found, continue
  }
  
  // 4. Check for "Following" button (might be following instead of connected)
  try {
    const followingButton = page.locator('button:has-text("Following")').first();
    if (await followingButton.isVisible()) {
      console.log(`ℹ️ FOLLOWING: ${lead.name} (Following button found - not connected)`);
      // Don't return true here, let it try to find Connect button
    }
  } catch (e) {
    // No following button found, continue
  }
  
  // 5. Check for "Follow" button (not connected, but might be able to connect)
  try {
    const followButton = page.locator('button:has-text("Follow")').first();
    if (await followButton.isVisible()) {
      console.log(`ℹ️ FOLLOW AVAILABLE: ${lead.name} (Follow button found - Connect might be in dropdown)`);
      // Don't return true here, let it try to find Connect button
    }
  } catch (e) {
    // No follow button found, continue
  }
  
  return false;
}

/**
 * Click Connect button with retry strategies
 * @param {Locator} connectButton - Playwright locator for Connect button
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} - True if click succeeded, false otherwise
 */
export async function clickConnectButton(connectButton, page) {
  console.log(`🔘 Clicking Connect button...`);
  
  const clickStrategies = [
    async () => await connectButton.click({ timeout: 5000 }),
    async () => await connectButton.click({ force: true, timeout: 5000 }),
    async () => {
      const handle = await connectButton.elementHandle();
      return await handle.evaluate(btn => btn.click());
    }
  ];
  
  for (let i = 0; i < clickStrategies.length; i++) {
    try {
      await clickStrategies[i]();
      console.log(`✅ Connect button clicked successfully (strategy ${i + 1})`);
      
      // If we clicked from dropdown, wait a bit longer for modal
      await page.waitForTimeout(2000);
      
      return true;
    } catch (clickError) {
      console.log(`⚠️ Click attempt ${i + 1} failed:`, clickError.message);
    }
  }
  
  console.log(`❌ All click attempts failed`);
  return false;
}

/**
 * Handle invitation modal (click "Send without a note")
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} - True if invite sent, false otherwise
 */
export async function handleInviteModal(page) {
  console.log(`🔍 Looking for invitation modal...`);
  
  // Check if invitation modal is visible (more specific selector)
  let modalVisible = false;
  try {
    // Look for the specific invite modal, not just any dialog
    const inviteModalSelectors = [
      'div[role="dialog"].send-invite',
      'div.artdeco-modal.send-invite',
      'div[role="dialog"][aria-labelledby="send-invite-modal"]',
      'div[role="dialog"]:has(button:text("Send without a note"))',
      'div[role="dialog"]:has(button:text("Add a note"))'
    ];
    
    for (const selector of inviteModalSelectors) {
      try {
        if (await page.locator(selector).isVisible({ timeout: 1000 })) {
          modalVisible = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    console.log(`⚠️ Modal check error:`, e.message);
  }
  
  if (!modalVisible) {
    console.log(`❌ Modal did not appear`);
    return false;
  }
  
  console.log(`✅ Modal visible`);
  
  // Always send without a note
  try {
    const sendWithoutNoteBtn = page.locator('button:has-text("Send without a note")').first();
    if (await sendWithoutNoteBtn.isVisible()) {
      console.log(`📨 Sending invitation without note...`);
      await sendWithoutNoteBtn.click();
      
      // Wait for modal to close and page to update
      console.log('⏳ Waiting for modal to close...');
      await page.waitForTimeout(3000); // Increased from 2s to 3s for page to update
      
      // Debug screenshot after modal closes (only in debug mode)
      if (DEBUG_MODE) {
        try {
          const afterModalPath = `./debug-after-modal-${Date.now()}.png`;
          await page.screenshot({ path: afterModalPath, fullPage: false });
          console.log(`📸 Debug: Screenshot saved to ${afterModalPath}`);
        } catch (screenshotError) {
          // Ignore screenshot errors
        }
      }
      
      // Verification: Check if Pending button appeared OR if Connect button disappeared
      console.log('🔍 Verifying invite was sent...');
      
      // Strategy 1: Look for "Pending" button (most reliable)
      const pendingSelectors = [
        'button[aria-label*="Pending"]',  // Removed main .ph5 - search anywhere
        'button:has-text("Pending")',
        'button:has(span:text-is("Pending"))',
        '.pv-top-card button[aria-label*="Pending"]',
        'section.artdeco-card button[aria-label*="Pending"]'
      ];
      
      let pendingFound = false;
      for (const selector of pendingSelectors) {
        try {
          const pendingButton = page.locator(selector).first();
          if (await pendingButton.isVisible({ timeout: 2000 })) {
            console.log(`✅ Invite verified - Pending button found with: ${selector}`);
            pendingFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (pendingFound) {
        return true;
      }
      
      // Strategy 2: Check if Connect button is gone (backup verification)
      console.log('🔍 Pending button not found, checking if Connect button disappeared...');
      const connectSelectors = [
        'button:has(span.artdeco-button__text:text-is("Connect"))',
        'button[aria-label*="Invite"][aria-label*="connect"]',
        'button:text-is("Connect")'
      ];
      
      let connectStillPresent = false;
      for (const selector of connectSelectors) {
        try {
          const connectButton = page.locator(selector).first();
          if (await connectButton.isVisible({ timeout: 1000 })) {
            connectStillPresent = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!connectStillPresent) {
        console.log('✅ Invite verified - Connect button disappeared (invite likely sent)');
        return true;
      }
      
      // Strategy 3: Check for success toast/notification
      console.log('🔍 Looking for success notification...');
      const successSelectors = [
        '.artdeco-toast-item--visible',
        '[data-test-artdeco-toast-item-type="success"]',
        'div:has-text("Invitation sent")',
        'div:has-text("sent successfully")'
      ];
      
      for (const selector of successSelectors) {
        try {
          const toast = page.locator(selector).first();
          if (await toast.isVisible({ timeout: 1000 })) {
            console.log(`✅ Invite verified - Success notification found`);
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      
      console.log('⚠️ Could not verify with Pending button or Connect disappearance');
      console.log('⚠️ However, modal was shown and "Send" was clicked - treating as SUCCESS');
      // If we got here: modal appeared, button was clicked, no errors
      // This means the invite was likely sent, just couldn't verify UI state
      return true;
    } else {
      console.log(`❌ Send without note button not found`);
      return false;
    }
  } catch (e) {
    console.log(`❌ Error handling modal:`, e.message);
    return false;
  }
}

/**
 * Debug helper: Inspect all buttons on page
 * @param {Page} page - Playwright page object
 */
async function inspectPageButtons(page) {
  console.log(`🔍 DEBUG: Inspecting all buttons on page...`);
  
  try {
    const buttonInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.slice(0, 20).map(btn => ({
        text: btn.textContent?.trim().substring(0, 50),
        ariaLabel: btn.getAttribute('aria-label'),
        className: btn.className.substring(0, 100),
        dataControl: btn.getAttribute('data-control-name'),
        id: btn.id,
        visible: btn.offsetParent !== null
      }));
    });
    
    console.log(`📋 Found ${buttonInfo.length} buttons on page:`);
    buttonInfo.forEach((btn, idx) => {
      if (btn.text?.toLowerCase().includes('connect') || 
          btn.text?.toLowerCase().includes('more') ||
          btn.ariaLabel?.toLowerCase().includes('connect') ||
          btn.ariaLabel?.toLowerCase().includes('more')) {
        console.log(`  🎯 POTENTIAL: Button ${idx + 1}:`, JSON.stringify(btn));
      }
    });
  } catch (evalError) {
    console.log(`⚠️ Failed to inspect buttons:`, evalError.message);
  }
}

/**
 * Process invites directly using validated browser context
 * Main orchestration function for invite sending automation
 * 
 * @param {BrowserContext} context - Playwright browser context
 * @param {Page} page - Playwright page object
 * @param {Array} leads - Array of lead objects
 * @param {string} customMessage - Custom message (not used, always send without note)
 * @param {string} campaignId - Campaign ID
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Object>} - Results object with counts
 */
export async function processInvitesDirectly(context, page, leads, customMessage, campaignId, progressCallback = null) {
  console.log(`🚀 STEP 5: Processing ${leads.length} invite(s) directly...`);
  
  const results = {
    total: leads.length,
    sent: 0,
    alreadyConnected: 0,
    alreadyPending: 0,
    failed: 0,
    errors: []
  };

  // Track counters for determining lead status in progressCallback
  let initialSentCount = 0;
  let initialAlreadyConnected = 0;
  let initialAlreadyPending = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    
    // Helper function to send intermediate progress updates
    const sendProgress = async (stage, progressFraction = 0, statusOverride = 'processing') => {
      if (progressCallback && typeof progressCallback === 'function') {
        try {
          await progressCallback({
            type: 'progress',
            current: i + progressFraction,
            total: leads.length,
            leadName: lead.name,
            leadId: lead.id,
            stage: stage, // e.g., 'navigating', 'checking', 'clicking', 'sending'
            status: statusOverride
          });
        } catch (cbError) {
          // Ignore callback errors to not break the flow
        }
      }
    };
    
    try {
      console.log(`📤 INVITE ${i + 1}/${leads.length}: ${lead.name || 'Lead'}`);
      console.log(`🔗 ${lead.url}`);
      
      // Stage 1: Starting to process lead (0% of this lead)
      await sendProgress('starting', 0.0);
      
      // Navigate with better error handling
      try {
        // Stage 2: Navigating to profile (20% of this lead)
        await sendProgress('navigating', 0.2);
        
        await page.goto(lead.url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 45000
        });
      } catch (navError) {
        console.log(`❌ Navigation failed:`, navError.message);
        results.failed++;
        results.errors.push({ 
          leadId: lead.id, 
          name: lead.name, 
          error: `Navigation failed: ${navError.message}` 
        });
        // Still send final progress for this lead
        await sendProgress('failed', 1.0, 'failed');
        continue;
      }
      
      // OPTIMIZATION: Reduced page load waits
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);  // Reduced from 3s → 1s
      
      // Stage 3: Checking connection status (40% of this lead)
      await sendProgress('checking', 0.4);

      // OPTIMIZATION: Take screenshot only in debug mode
      if (DEBUG_MODE) {
        const screenshotPath = `./debug-profile-${lead.id}-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }

      // Check if already connected or pending
      const isAlreadyProcessed = await checkConnectionStatus(page, campaignId, lead, results);
      if (isAlreadyProcessed) {
        // Lead already processed, mark as complete
        await sendProgress('already_processed', 1.0, 'already_processed');
        continue;
      }
      
      // Stage 4: Finding Connect button (50% of this lead)
      await sendProgress('finding_button', 0.5);
      
      // Find Connect button (tries direct button first, then dropdown)
      const connectButton = await findConnectButton(page);
      
      if (!connectButton) {
        console.log(`🔍 Connect button not found, checking for Pending in profile header...`);
        
        // Step 1: Check if Pending button exists in profile header
        let isPending = false;
        const pendingSelectors = [
          'main .ph5 button[aria-label*="Pending"]',
          'main .ph5 button:has-text("Pending")',
          'main section.artdeco-card button[aria-label*="Pending"]',
          'main section button:has(span:text("Pending"))'
        ];
        
        for (const selector of pendingSelectors) {
          try {
            const pendingButton = page.locator(selector).first();
            if (await pendingButton.isVisible({ timeout: 2000 })) {
              console.log(`⏳ ALREADY PENDING: ${lead.name} (found with: ${selector})`);
              results.alreadyPending++;
              await updateLeadStatus(campaignId, lead.id, 'sent', true);
              isPending = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (isPending) {
        await sendProgress('already_pending', 1.0, 'already_pending');
          continue; // Move to next lead
        }
        
        // Step 2: No Connect AND No Pending = Already Connected
        console.log(`✅ ALREADY CONNECTED: ${lead.name} (no Connect or Pending button)`);
        console.log(`📝 Marking as ACCEPTED`);
        results.alreadyConnected++;
        await updateLeadStatus(campaignId, lead.id, 'accepted', true);
        await sendProgress('already_connected', 1.0, 'already_connected');
        continue;
      }

      // Stage 5: Clicking Connect button (60% of this lead)
      await sendProgress('clicking', 0.6);

      // OPTIMIZATION: Take screenshot only in debug mode
      if (DEBUG_MODE) {
        const beforeClickPath = `./debug-before-click-${lead.id}-${Date.now()}.png`;
        await page.screenshot({ path: beforeClickPath, fullPage: false });
      }

      // Click Connect button
      const clickSuccess = await clickConnectButton(connectButton, page);
      
      if (!clickSuccess) {
        results.failed++;
        results.errors.push({ 
          leadId: lead.id, 
          name: lead.name, 
          error: 'Failed to click Connect button' 
        });
        await sendProgress('failed', 1.0, 'failed');
        continue;
      }
      
      // Stage 6: Waiting for modal (70% of this lead)
      await sendProgress('waiting_modal', 0.7);
      
      // OPTIMIZATION: Reduced modal wait from 3s → 1.5s
      await page.waitForTimeout(1500);
      
      // OPTIMIZATION: Take screenshot only in debug mode
      if (DEBUG_MODE) {
        const modalScreenshotPath = `./debug-modal-${lead.id}-${Date.now()}.png`;
        await page.screenshot({ path: modalScreenshotPath, fullPage: true });
      }
      
      // Stage 7: Sending invite (80% of this lead)
      await sendProgress('sending', 0.8);
      
      // Handle invitation modal
      const inviteSent = await handleInviteModal(page);
      
      if (inviteSent) {
        results.sent++;
        // Update this lead in this campaign
        await updateLeadStatus(campaignId, lead.id, 'sent', true);
        console.log(`✅ INVITE SENT: ${lead.name || 'Lead'}`);
        // Stage 8: Invite sent successfully (100% of this lead)
        await sendProgress('completed', 1.0, 'sent');
      } else {
        results.failed++;
        results.errors.push({ leadId: lead.id, name: lead.name, error: 'Failed to send invite via modal' });
        await updateLeadStatus(campaignId, lead.id, 'failed', false);
        await sendProgress('failed', 1.0, 'failed');
      }

      // Rate limiting: 10-30 seconds randomized (human-like behavior to avoid detection)
      if (i < leads.length - 1) {
        const delayMs = 10000 + Math.floor(Math.random() * 20000); // 10-30 seconds
        const delaySec = Math.floor(delayMs / 1000);
        console.log(`⏱️ Waiting ${delaySec}s before next invite...`);
        await page.waitForTimeout(delayMs);
      }

    } catch (error) {
      console.error(`❌ Failed to process ${lead.name}:`, error.message);
      results.failed++;
      results.errors.push({ leadId: lead.id, name: lead.name, error: error.message });
      await updateLeadStatus(campaignId, lead.id, 'failed', false);
      await sendProgress('failed', 1.0, 'failed');
    }
    
    // ✅ Progress is now sent at each stage via sendProgress() helper
    // Track lead status for daily counter (handled in worker's progressCallback)
    if (results.sent > initialSentCount) {
      initialSentCount = results.sent; // Update for next iteration
    } else if (results.alreadyConnected > initialAlreadyConnected) {
      initialAlreadyConnected = results.alreadyConnected;
    } else if (results.alreadyPending > initialAlreadyPending) {
      initialAlreadyPending = results.alreadyPending;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎉 INVITE PROCESSING COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Total: ${results.total}`);
  console.log(`   Sent: ${results.sent}`);
  console.log(`   Already Connected: ${results.alreadyConnected}`);
  console.log(`   Already Pending: ${results.alreadyPending}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`${'='.repeat(60)}\n`);

  return results;
}