import path from 'path';
import os from 'os';
import fs from 'fs';
import LinkedInSessionManager from './linkedin-session.js';

/**
 * LinkedIn Invite Service
 * 
 * Handles browser automation for sending LinkedIn connection invites
 * with anti-detection measures and session management
 */
export class LinkedInInviteService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.sessionManager = new LinkedInSessionManager();
    this.linkedinAccountId = null;
  }

  /**
   * Get OS-agnostic profile path for browser persistence
   */
  getProfilePath(accountId) {
    const userHome = os.homedir();
    return path.join(userHome, '.linkedin-profiles', accountId);
  }

  /**
   * Get cross-platform user agent based on OS
   */
  getUserAgent() {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    } else if (platform === 'darwin') {
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    } else {
      return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }
  }

  /**
   * Initialize browser with anti-detection measures
   */
  async initializeBrowser(linkedinAccountId) {
    try {
      console.log(`🌐 Initializing browser for LinkedIn account: ${linkedinAccountId}`);
      
      this.linkedinAccountId = linkedinAccountId;
      const profilePath = this.getProfilePath(linkedinAccountId);
      
      // Clear old persistent context to prevent session corruption on retry
      if (fs.existsSync(profilePath)) {
        console.log(`🧹 Clearing old browser context: ${profilePath}`);
        fs.rmSync(profilePath, { recursive: true, force: true });
        console.log(`✅ Old context cleared`);
      }
      
      // Import Playwright dynamically
      const { chromium } = await import('playwright');
      
      // Get user agent for this OS
      const userAgent = this.getUserAgent();
      console.log(`🔧 User-Agent: ${userAgent}`);
      
      // Launch browser in persistent context with anti-detection
      this.context = await chromium.launchPersistentContext(profilePath, {
        headless: true, // DEBUGGING: Set to false to see what's happening
        slowMo: 1000, // Slow down operations to appear more human-like
        userAgent: userAgent, // Set user agent during context creation
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-infobars',
          '--disable-dev-shm-usage',
          '--disable-features=site-per-process',
          '--disable-gpu',
          '--window-size=1280,800',
        ],
        viewport: { width: 1280, height: 800 }
      });

      // Get or create page
      this.page = this.context.pages()[0] || await this.context.newPage();

      // Inject anti-bot detection scripts
      await this.page.addInitScript(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // Add chrome object
        window.chrome = { runtime: {} };
        
        // Override languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        
        // Add fake plugins
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });

      console.log('✅ Browser initialized with anti-detection measures');
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Restore LinkedIn session from database
   */
  async restoreSession(linkedinAccountId) {
    try {
      console.log(`🔄 Restoring LinkedIn session for account: ${linkedinAccountId}`);
      
      // Fetch session data from database
      const sessionData = await this.sessionManager.loadSession(linkedinAccountId);
      
      if (!sessionData) {
        throw new Error(`No session data found for account: ${linkedinAccountId}`);
      }

      // Restore cookies BEFORE navigation
      if (sessionData.cookies && sessionData.cookies.length > 0) {
        await this.context.addCookies(sessionData.cookies);
        console.log(`✅ Restored ${sessionData.cookies.length} cookies`);
      }

      // Navigate to about:blank first to ensure init scripts run
      await this.page.goto('about:blank');

      // Restore localStorage
      if (sessionData.localStorage) {
        await this.page.addInitScript((localStorage) => {
          Object.keys(localStorage).forEach(key => {
            window.localStorage.setItem(key, localStorage[key]);
          });
        }, sessionData.localStorage);
        console.log(`✅ Restored localStorage`);
      }

      // Restore sessionStorage
      if (sessionData.sessionStorage) {
        await this.page.addInitScript((sessionStorage) => {
          Object.keys(sessionStorage).forEach(key => {
            window.sessionStorage.setItem(key, sessionStorage[key]);
          });
        }, sessionData.sessionStorage);
        console.log(`✅ Restored sessionStorage`);
      }

      console.log('✅ Session restoration complete');
      return sessionData;

    } catch (error) {
      console.error('❌ Failed to restore session:', error);
      throw error;
    }
  }

  /**
   * Validate LinkedIn session by checking if logged in
   */
  async validateSession() {
    try {
      console.log('🧪 Validating LinkedIn session...');
      
      // Navigate to LinkedIn feed to verify session
      await this.page.goto('https://www.linkedin.com/feed/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait a bit for any redirects
      await this.page.waitForTimeout(3000);

      // Check current URL
      const currentUrl = this.page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      // Check if redirected to login page (session invalid)
      if (currentUrl.includes('linkedin.com/login') || 
          currentUrl.includes('linkedin.com/uas/login') ||
          currentUrl.includes('linkedin.com/checkpoint/')) {
        throw new Error('Session expired or invalid - redirected to login page');
      }

      // Check if successfully reached authenticated pages
      if (currentUrl.includes('linkedin.com/feed') || 
          currentUrl.includes('linkedin.com/in/') ||
          currentUrl.includes('linkedin.com/mynetwork/') ||
          currentUrl.includes('linkedin.com/messaging/')) {
        console.log('✅ Session validated successfully - user is logged in');
        return true;
      }

      throw new Error(`Unexpected page after navigation: ${currentUrl}`);

    } catch (error) {
      console.error('❌ Session validation failed:', error);
      throw error;
    }
  }

  /**
   * Send connection invite to a lead
   */
  async sendInvite(lead, customMessage) {
    try {
      console.log(`📤 Sending invite to: ${lead.name} (${lead.url})`);
      
      // Navigate to lead's profile
      await this.page.goto(lead.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for page to load
      await this.page.waitForTimeout(2000);

      // Log navigation success
      const currentUrl = this.page.url();
      const pageTitle = await this.page.title();
      console.log(`✅ NAVIGATED: Successfully reached ${currentUrl}`);
      console.log(`📄 PAGE TITLE: ${pageTitle}`);

      // Check if already connected
      console.log(`🔍 SEARCHING: Looking for Connect/Pending/Message buttons...`);
      const pendingButton = await this.page.$('button:has-text("Pending")');
      const messageButton = await this.page.$('button:has-text("Message")');
      
      if (pendingButton) {
        console.log(`⏳ ALREADY PENDING: Invite already sent to ${lead.name} - showing as "Pending"`);
        return { 
          success: true, 
          status: 'already_pending',
          message: 'Invite already sent - waiting for acceptance'
        };
      }
      
      if (messageButton) {
        console.log(`✅ ALREADY CONNECTED: User is already connected to ${lead.name} - showing "Message" button`);
        return { 
          success: true, 
          status: 'already_connected',
          message: 'Already connected - no invite needed'
        };
      }

      // Try to find and click "Connect" button
      // LinkedIn has multiple possible selectors for the Connect button
      const connectSelectors = [
        'button:has-text("Connect")',
        'button[aria-label*="Invite"][aria-label*="connect"]',
        'button[aria-label*="Connect"]',
        'button.pvs-profile-actions__action:has-text("Connect")',
        'button[data-control-name="connect"]'
      ];

      let connectButton = null;
      for (const selector of connectSelectors) {
        try {
          connectButton = await this.page.waitForSelector(selector, { timeout: 3000 });
          if (connectButton) {
            console.log(`✅ Found Connect button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
          continue;
        }
      }

      if (!connectButton) {
        // Take screenshot for debugging
        const screenshotPath = `./debug-no-connect-${lead.id}.png`;
        try {
          await this.page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`📸 SCREENSHOT: Saved to ${screenshotPath}`);
        } catch (screenshotError) {
          console.log(`⚠️ Failed to take screenshot:`, screenshotError.message);
        }
        
        // Log page HTML snippet for debugging
        try {
          const bodyHTML = await this.page.content();
          console.log(`📄 PAGE HTML SNIPPET (first 500 chars):`, bodyHTML.substring(0, 500));
        } catch (htmlError) {
          console.log(`⚠️ Failed to get page HTML:`, htmlError.message);
        }
        
        console.log(`❌ NO CONNECT BUTTON: Could not find Connect button for ${lead.name}`);
        throw new Error('Connect button not found - user may already be connected or button unavailable');
      }

      // Click Connect button
      await connectButton.click();
      await this.page.waitForTimeout(2000);

      // Check if "Add a note" dialog appears
      const addNoteButton = await this.page.$('button:has-text("Add a note")');
      
      if (addNoteButton && customMessage && customMessage.trim()) {
        console.log('📝 Adding custom message...');
        
        // Click "Add a note"
        await addNoteButton.click();
        await this.page.waitForTimeout(1000);

        // Find and fill the message textarea
        const messageTextarea = await this.page.waitForSelector('textarea[name="message"]', { timeout: 3000 });
        await messageTextarea.fill(customMessage);
        await this.page.waitForTimeout(500);

        console.log('✅ Custom message added');
      }

      // Click "Send" button to send the invite
      const sendButton = await this.page.waitForSelector('button[aria-label*="Send"][aria-label*="invitation"]', { timeout: 3000 });
      if (!sendButton) {
        // Try alternative send button selector
        const altSendButton = await this.page.$('button:has-text("Send")');
        if (altSendButton) {
          await altSendButton.click();
        } else {
          throw new Error('Send button not found');
        }
      } else {
        await sendButton.click();
      }

      // Wait for confirmation
      await this.page.waitForTimeout(2000);

      console.log(`✅ Invite sent successfully to ${lead.name}`);
      return { 
        success: true, 
        status: 'invite_sent',
        message: 'Invitation sent successfully'
      };

    } catch (error) {
      console.error(`❌ Failed to send invite to ${lead.name}:`, error.message);
      throw error;
    }
  }

  /**
   * Close browser and cleanup
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up browser resources...');
      
      if (this.context) {
        await this.context.close();
        this.context = null;
        this.page = null;
      }
      
      console.log('✅ Browser cleanup complete');
      return true;

    } catch (error) {
      console.error('❌ Failed to cleanup browser:', error);
      throw error;
    }
  }
}

export default LinkedInInviteService;

