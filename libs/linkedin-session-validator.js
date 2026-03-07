/**
 * LinkedIn Session Validator Module
 * 
 * Handles LinkedIn session validation using Playwright browser automation.
 * Separated from main workflow for better reusability and testing.
 */

/**
 * Test LinkedIn session validity using browser automation
 * 
 * @param {Object} sessionData - Session data with cookies, localStorage, sessionStorage
 * @param {boolean} keepOpen - If true, keeps browser open and returns context/page for reuse
 * @returns {Promise<Object>} - Validation result with isValid, reason, and optionally context/page
 */
export async function testLinkedInSession(sessionData, keepOpen = false) {
  console.log('🧪 Testing LinkedIn session validity...');
  
  try {
    // Import Playwright dynamically to avoid issues in serverless environments
    const { chromium } = await import('playwright');
    
    // Launch browser context (configured for serverless environments)
    const context = await chromium.launchPersistentContext(
      `/tmp/linkedin-test-${sessionData.sessionId}`,
      {
        headless: true,
        viewport: { width: 1280, height: 720 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    );

    const page = context.pages()[0] || await context.newPage();

    try {
      // Restore session data
      console.log('🔄 Restoring session data...');
      
      // Set cookies
      if (sessionData.cookies && sessionData.cookies.length > 0) {
        await context.addCookies(sessionData.cookies);
      }

      // Set localStorage
      if (sessionData.localStorage) {
        await page.addInitScript((localStorage) => {
          Object.keys(localStorage).forEach(key => {
            window.localStorage.setItem(key, localStorage[key]);
          });
        }, sessionData.localStorage);
      }

      // Set sessionStorage
      if (sessionData.sessionStorage) {
        await page.addInitScript((sessionStorage) => {
          Object.keys(sessionStorage).forEach(key => {
            window.sessionStorage.setItem(key, sessionStorage[key]);
          });
        }, sessionData.sessionStorage);
      }

      // Try to access LinkedIn feed page
      console.log('🌐 Accessing LinkedIn feed page...');
      await page.goto('https://www.linkedin.com/feed/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for page to load
      await page.waitForTimeout(3000);

      // Check current URL
      const currentUrl = page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      // Check if redirected to login page (session invalid)
      if (currentUrl.includes('linkedin.com/login') || 
          currentUrl.includes('linkedin.com/uas/login') ||
          currentUrl.includes('linkedin.com/checkpoint/')) {
        console.log('❌ Session is invalid - redirected to login page');
        await context.close();
        return {
          isValid: false,
          reason: 'Session expired or invalid - redirected to login page',
          currentUrl
        };
      }

      // Check if successfully reached authenticated pages
      if (currentUrl.includes('linkedin.com/feed') || 
          currentUrl.includes('linkedin.com/in/') ||
          currentUrl.includes('linkedin.com/mynetwork/') ||
          currentUrl.includes('linkedin.com/messaging/')) {
        
        console.log('✅ Session is valid - successfully accessed authenticated page');
        
        if (keepOpen) {
          // Return browser context and page for immediate invite processing
          console.log('🔓 Keeping browser open for invite processing...');
          return {
            isValid: true,
            reason: 'Successfully accessed LinkedIn authenticated page',
            currentUrl,
            context: context,
            page: page
          };
        } else {
          // Close browser and return validation result only
          await context.close();
          return {
            isValid: true,
            reason: 'Successfully accessed LinkedIn authenticated page',
            currentUrl
          };
        }
      }

      // Unexpected page
      console.log('⚠️ Unexpected page - session validity unclear');
      await context.close();
      return {
        isValid: false,
        reason: 'Unexpected page after navigation',
        currentUrl
      };

    } catch (error) {
      console.error('❌ Error testing session:', error.message);
      await context.close();
      return {
        isValid: false,
        reason: `Error testing session: ${error.message}`,
        currentUrl: null
      };
    }

  } catch (error) {
    console.error('❌ Browser launch failed:', error.message);
    return {
      isValid: false,
      reason: `Browser launch failed: ${error.message}`,
      currentUrl: null
    };
  }
}

/**
 * Validate session and keep browser open for immediate use
 * Simplified wrapper around testLinkedInSession
 * 
 * @param {Object} accountData - Account data with session information
 * @returns {Promise<Object>} - Validation result with context and page
 */
export async function validateAndKeepOpen(accountData) {
  return await testLinkedInSession(accountData, true);
}

/**
 * Clean up browser session (close context and page)
 * 
 * @param {BrowserContext} context - Playwright browser context
 * @param {Page} page - Playwright page object (optional, not used but kept for API consistency)
 */
export async function cleanupBrowserSession(context, page = null) {
  console.log(`🔒 Closing browser session...`);
  
  try {
    if (context) {
      await context.close();
      console.log(`✅ Browser closed successfully`);
    }
  } catch (closeError) {
    console.error(`❌ Failed to close browser:`, closeError.message);
  }
}

