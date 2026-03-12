/**
 * LinkedIn Message Sender Service
 * 
 * Handles automated LinkedIn message sending with robust selector strategies
 * to ensure compatibility even if LinkedIn changes their UI.
 */

/**
 * Find Message button using multiple fallback strategies
 * @param {Page} page - Playwright page object
 * @returns {Promise<Locator|null>} - Message button locator or null
 */
export async function findMessageButton(page) {
  console.log('🔍 Searching for Message button...');

  // Strategy 1: aria-label (most semantic and stable)
  const ariaLabelSelectors = [
    'button[aria-label="Message"]',
    'button[aria-label*="Send a message"]',
    'button[aria-label*="Message"]'
  ];

  for (const selector of ariaLabelSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`✅ Found Message button via aria-label: ${selector}`);
        return button;
      }
    } catch (e) {
      continue;
    }
  }

  // Strategy 2: data-control-name (stable identifiers)
  const dataControlSelectors = [
    'button[data-control-name="message"]',
    'button[data-control-name="send_message"]',
    'a[data-control-name="message"]'
  ];

  for (const selector of dataControlSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`✅ Found Message button via data-control-name: ${selector}`);
        return button;
      }
    } catch (e) {
      continue;
    }
  }

  // Strategy 3: Text content matching
  const textSelectors = [
    'button:has-text("Message")',
    'button:has(span:text("Message"))',
    'a:has-text("Message")'
  ];

  for (const selector of textSelectors) {
    try {
      const buttons = await page.locator(selector).all();
      
      for (const button of buttons) {
        try {
          const isVisible = await button.isVisible().catch(() => false);
          if (!isVisible) continue;

          const text = await button.textContent().catch(() => '');
          const cleanText = text.trim().toLowerCase();

          // Verify it's actually a Message button (not "Message sent", "Messaging", etc.)
          if (cleanText === 'message' || cleanText === 'send message') {
            // Ensure it's not disabled
            const isDisabled = await button.isDisabled().catch(() => false);
            if (!isDisabled) {
              console.log(`✅ Found Message button via text content`);
              return button;
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

  // Strategy 4: Compound selectors with class names (LinkedIn's artdeco design system)
  const compoundSelectors = [
    'button.artdeco-button:has-text("Message")',
    'button.pvs-profile-actions__action:has-text("Message")',
    'div.pvs-profile-actions button:has-text("Message")'
  ];

  for (const selector of compoundSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        const text = await button.textContent().catch(() => '');
        if (text.toLowerCase().includes('message') && !text.toLowerCase().includes('pending')) {
          console.log(`✅ Found Message button via compound selector`);
          return button;
        }
      }
    } catch (e) {
      continue;
    }
  }

  console.log('❌ Message button not found with any strategy');
  return null;
}

/**
 * Open message dialog by clicking Message button
 * @param {Locator} messageButton - Message button locator
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} - True if dialog opened successfully
 */
export async function openMessageDialog(messageButton, page) {
  console.log('💬 Opening message dialog...');

  try {
    // Scroll button into view
    await messageButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    // Try to read href – sometimes Message is an <a> to /messaging/compose
    let href = null;
    try {
      href = await messageButton.getAttribute('href');
    } catch (_) {
      href = null;
    }

    // If it's a compose link, navigate directly to avoid Premium overlays intercepting clicks
    if (href && href.includes('/messaging/compose')) {
      const absoluteUrl = href.startsWith('http')
        ? href
        : `https://www.linkedin.com${href}`;
      console.log(`🔁 Opening messaging compose via direct navigation: ${absoluteUrl}`);
      await page.goto(absoluteUrl, { waitUntil: 'networkidle' });
      console.log('✅ Navigated to messaging compose page');
    } else {
      // Otherwise click the message button as usual
      await messageButton.click({ timeout: 5000 });
      console.log('✅ Clicked Message button');
    }

    // Wait for message dialog to appear
    await page.waitForTimeout(2000);

    // Check if dialog appeared
    const dialogSelectors = [
      'div[role="dialog"]',
      'div.msg-overlay-bubble-header',
      'div.msg-form',
      'div[data-view-name="msg-overlay"]'
    ];

    for (const selector of dialogSelectors) {
      const dialog = page.locator(selector).first();
      if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('✅ Message dialog opened successfully');
        return true;
      }
    }

    console.log('⚠️ Message button clicked but dialog not detected');
    return true; // Assume it worked even if we can't confirm

  } catch (error) {
    console.error('❌ Failed to open message dialog:', error.message);
    return false;
  }
}

/**
 * Find and fill message textarea with human-like typing
 * @param {Page} page - Playwright page object
 * @param {string} messageContent - Message to send
 * @param {string} leadName - Lead name for logging
 * @returns {Promise<boolean>} - True if message was filled successfully
 */
export async function fillMessageTextarea(page, messageContent, leadName) {
  console.log(`✍️ Filling message for ${leadName}...`);

  try {
    // Multiple textarea selectors
    const textareaSelectors = [
      'div[role="textbox"]',
      'div.msg-form__contenteditable',
      'div.msg-form__msg-content-container div[contenteditable="true"]',
      'textarea[name="message"]',
      'div[data-view-name="msg-compose-box"] div[contenteditable="true"]'
    ];

    let textarea = null;

    for (const selector of textareaSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
          textarea = element;
          console.log(`✅ Found message textarea: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!textarea) {
      console.error('❌ Message textarea not found');
      return false;
    }

    // Click to focus
    await textarea.click({ timeout: 3000 });
    await page.waitForTimeout(500);

    // Type with human-like delays (faster than real typing but not instant)
    await textarea.fill(''); // Clear first
    await page.waitForTimeout(300);
    
    // Type the message with slight delays between characters
    for (let i = 0; i < messageContent.length; i++) {
      await textarea.type(messageContent[i], { delay: Math.random() * 30 + 20 }); // 20-50ms per char
    }

    console.log('✅ Message typed successfully');
    return true;

  } catch (error) {
    console.error('❌ Failed to fill message textarea:', error.message);
    return false;
  }
}

/**
 * Find and click Send button in message dialog
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} - True if send button was clicked
 */
export async function clickSendButton(page) {
  console.log('📤 Looking for Send button...');

  try {
    // Multiple Send button selectors
    const sendButtonSelectors = [
      'button[type="submit"]:has-text("Send")',
      'button.msg-form__send-button',
      'button[aria-label="Send"]',
      'button:has-text("Send")',
      'button.artdeco-button--primary:has-text("Send")'
    ];

    for (const selector of sendButtonSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
          const isDisabled = await button.isDisabled().catch(() => false);
          
          if (!isDisabled) {
            await button.click({ timeout: 3000 });
            console.log('✅ Clicked Send button');
            await page.waitForTimeout(2000); // Wait for send to complete
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }

    console.error('❌ Send button not found or disabled');
    return false;

  } catch (error) {
    console.error('❌ Failed to click Send button:', error.message);
    return false;
  }
}

/**
 * Send LinkedIn message to a lead
 * @param {Page} page - Playwright page object  
 * @param {string} leadUrl - LinkedIn profile URL
 * @param {string} messageContent - Message content to send
 * @param {string} leadName - Lead name for logging
 * @returns {Promise<Object>} - { success: boolean, error?: string }
 */
export async function sendMessageToLead(page, leadUrl, messageContent, leadName) {
  console.log(`\n📨 Attempting to send message to: ${leadName}`);
  console.log(`🔗 Profile URL: ${leadUrl}`);

  try {
    // Navigate to lead's profile
    console.log('🌐 Navigating to profile...');
    await page.goto(leadUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000); // Wait for page to stabilize

    // Find Message button
    const messageButton = await findMessageButton(page);
    
    if (!messageButton) {
      return {
        success: false,
        error: 'Message button not found - user may not be a connection'
      };
    }

    // Open message dialog
    const dialogOpened = await openMessageDialog(messageButton, page);
    
    if (!dialogOpened) {
      return {
        success: false,
        error: 'Failed to open message dialog'
      };
    }

    // Wait a bit for dialog to fully load
    await page.waitForTimeout(1500);

    // Fill message
    const messageFilled = await fillMessageTextarea(page, messageContent, leadName);
    
    if (!messageFilled) {
      return {
        success: false,
        error: 'Failed to fill message textarea'
      };
    }

    // Send message
    const messageSent = await clickSendButton(page);
    
    if (!messageSent) {
      return {
        success: false,
        error: 'Failed to click Send button'
      };
    }

    console.log(`✅ Message sent successfully to ${leadName}!`);
    
    return {
      success: true
    };

  } catch (error) {
    console.error(`❌ Failed to send message to ${leadName}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Add random delay between message sends (anti-detection)
 * @param {number} minSeconds - Minimum delay in seconds
 * @param {number} maxSeconds - Maximum delay in seconds
 */
export async function randomDelay(minSeconds = 30, maxSeconds = 90) {
  const delayMs = (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000;
  console.log(`⏳ Waiting ${Math.round(delayMs / 1000)}s before next message...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

