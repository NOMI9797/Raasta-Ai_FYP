import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import LinkedInSessionManager from '@/libs/linkedin-session';
import { withAuth } from "@/libs/auth-middleware";

// ---------- Anti-Detection Utilities ----------
function randomDelay(min = 1000, max = 3000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanLikeDelay(page, min = 1500, max = 4000) {
  const delay = randomDelay(min, max);
  await page.waitForTimeout(delay);
}

async function simulateHumanBehavior(page) {
  // Random mouse movement
  const x = Math.random() * 800 + 200;
  const y = Math.random() * 400 + 200;
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  
  // Random scroll
  if (Math.random() > 0.5) {
    await page.mouse.wheel(0, Math.random() * 200 - 100);
  }
  
  await page.waitForTimeout(randomDelay(500, 1500));
}

// Initialize session manager
const sessionManager = new LinkedInSessionManager();

// Track active connections to prevent duplicates
const activeConnections = new Set();

// URL patterns for different LinkedIn pages
const LINKEDIN_PATTERNS = {
  SUCCESS: [
    'linkedin.com/feed',
    'linkedin.com/in/',
    'linkedin.com/mynetwork/',
    'linkedin.com/messaging/',
    'linkedin.com/notifications/'
  ],
  INTERMEDIATE: [
    'linkedin.com/checkpoint/',
    'linkedin.com/challenge/',
    'linkedin.com/uas/challenge/',
    'linkedin.com/checkpoint/challenge/',
    'linkedin.com/checkpoint/verify-',
    'linkedin.com/checkpoint/challenge/'
  ],
  LOGIN: [
    'linkedin.com/login',
    'linkedin.com/uas/login'
  ]
};

// Helper function to check if URL matches any pattern
function urlMatchesPatterns(url, patterns) {
  return patterns.some(pattern => url.includes(pattern));
}

// Capture a screenshot and return as base64 data URI
async function captureScreenshot(page, label) {
  try {
    const buffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
    const base64 = buffer.toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64}`;
    console.log(`📸 Screenshot captured: ${label}`);
    return { label, dataUri, url: page.url(), timestamp: new Date().toISOString() };
  } catch (err) {
    console.warn(`⚠️ Screenshot failed for "${label}":`, err.message);
    return { label, dataUri: null, url: page.url(), timestamp: new Date().toISOString(), error: err.message };
  }
}

// Browser-based LinkedIn connection with automated login
async function connectLinkedInViaBrowser(sessionId, email, password) {
  console.log('🚀 Starting automated LinkedIn connection...');

  const screenshots = [];

  const browser = await chromium.launch({
    headless: true,
    slowMo: 1000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // ── Step 1: Open login page ──
    console.log('🌐 Opening LinkedIn login page...');
    await page.goto('https://www.linkedin.com/login');
    await page.waitForLoadState('domcontentloaded');
    await humanLikeDelay(page, 2000, 4000);
    await simulateHumanBehavior(page);
    screenshots.push(await captureScreenshot(page, 'Login page loaded'));

    // ── Step 2: Fill credentials ──
    console.log('🔐 Attempting automated login...');
    
    const emailField = page.locator('#username');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.click();
    await humanLikeDelay(page, 500, 1000);
    await emailField.fill(email);
    await humanLikeDelay(page, 500, 1000);

    const passwordField = page.locator('#password');
    await passwordField.waitFor({ state: 'visible', timeout: 10000 });
    await passwordField.click();
    await humanLikeDelay(page, 500, 1000);
    await passwordField.fill(password);
    await humanLikeDelay(page, 1000, 2000);
    screenshots.push(await captureScreenshot(page, 'Credentials filled'));

    // ── Step 3: Submit form ──
    const signInButton = page.locator('button[type="submit"]');
    await signInButton.waitFor({ state: 'visible', timeout: 10000 });
    await signInButton.click();
    
    console.log('📝 Login credentials submitted, waiting for response...');
    await humanLikeDelay(page, 3000, 5000);
    screenshots.push(await captureScreenshot(page, 'After submit'));
    
    // Quick check for immediate 2FA redirect after login
    const immediateUrl = await page.url();
    if (immediateUrl.includes('/checkpoint/') || immediateUrl.includes('/challenge/')) {
      screenshots.push(await captureScreenshot(page, '2FA checkpoint detected'));
      console.log('❌ 2FA/OTP verification detected immediately after login');
      throw new Error('2FA_NOT_SUPPORTED');
    }
    
    // ── Step 4: Poll for login success ──
    try {
      let loginCompleted = false;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (!loginCompleted && attempts < maxAttempts) {
        const currentUrl = await page.url();
        console.log(`🔍 Checking login status... (${attempts + 1}/${maxAttempts}) - Current URL: ${currentUrl}`);
        
        const isSuccessPage = urlMatchesPatterns(currentUrl, LINKEDIN_PATTERNS.SUCCESS);
        const isIntermediatePage = urlMatchesPatterns(currentUrl, LINKEDIN_PATTERNS.INTERMEDIATE);
        const isLoginPage = urlMatchesPatterns(currentUrl, LINKEDIN_PATTERNS.LOGIN);
        
        if (currentUrl.includes('/checkpoint/') || currentUrl.includes('/challenge/')) {
          screenshots.push(await captureScreenshot(page, '2FA checkpoint during polling'));
          console.log('❌ 2FA/OTP verification detected - Account has 2FA enabled');
          throw new Error('2FA_NOT_SUPPORTED');
        }
        
        const errorMessage = await page.locator('.form__input--error, .alert, .error-message, [data-test-id="error-message"]').first().textContent().catch(() => null);
        
        if (isSuccessPage) {
          console.log('✅ LinkedIn login successful!');
          screenshots.push(await captureScreenshot(page, 'Login successful — feed loaded'));
          loginCompleted = true;
          break;
        } else if (isIntermediatePage) {
          screenshots.push(await captureScreenshot(page, 'Intermediate/2FA page'));
          console.log('❌ Account requires 2FA/verification which is not supported');
          throw new Error('2FA_NOT_SUPPORTED');
        } else if (isLoginPage && attempts > 5) {
          if (errorMessage) {
            console.log('❌ Login error detected:', errorMessage);
            if (errorMessage.toLowerCase().includes('password') || errorMessage.toLowerCase().includes('credentials')) {
              screenshots.push(await captureScreenshot(page, 'Invalid credentials error'));
              throw new Error('INVALID_CREDENTIALS');
            }
          }
          screenshots.push(await captureScreenshot(page, 'Login failed — still on login page'));
          console.log('❌ Login failed - still on login page');
          throw new Error('LOGIN_FAILED');
        }
        
        await page.waitForTimeout(5000);
        attempts++;
      }
      
      if (!loginCompleted) {
        screenshots.push(await captureScreenshot(page, 'Login timeout'));
        console.log('⚠️ Login timeout after 2.5 minutes');
        throw new Error('LOGIN_TIMEOUT');
      }
      
      console.log('🎉 Automated login completed successfully!');
      
    } catch (error) {
      console.log('⚠️ Login error:', error.message);
      throw error;
    }

    await humanLikeDelay(page, 2000, 4000);

    // ── Step 5: Capture session data only (no profile scraping) ──
    const userName = email || 'linkedin-account';
    const profileImageUrl = null;

    const cookies = await context.cookies();
    const localStorage = await page.evaluate(() => {
      const storage = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        storage[key] = window.localStorage.getItem(key);
      }
      return storage;
    });

    const sessionStorage = await page.evaluate(() => {
      const storage = {};
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        storage[key] = window.sessionStorage.getItem(key);
      }
      return storage;
    });

    screenshots.push(await captureScreenshot(page, 'Session data captured — done'));

    await context.close();
    await browser.close();
    
    return { cookies, localStorage, sessionStorage, userName, profileImageUrl, screenshots };

  } catch (error) {
    // Capture final error state before closing
    try {
      screenshots.push(await captureScreenshot(page, `Error state — ${error.message}`));
    } catch {}
    await context.close();
    await browser.close();
    error.screenshots = screenshots;
    throw error;
  }
}

export const POST = withAuth(async (request, { user }) => {
  try {
    // Check if user already has an active connection
    if (activeConnections.has(user.id)) {
      console.log('⚠️ User already has an active connection in progress');
      return NextResponse.json(
        { 
          error: 'CONNECTION_IN_PROGRESS',
          message: 'A LinkedIn connection is already in progress for this user. Please wait for it to complete.'
        },
        { status: 409 }
      );
    }
    
    // Add user to active connections
    activeConnections.add(user.id);
    
    // Parse request body to get email and password
    const body = await request.json();
    const { email, password } = body;
    
    // Validate required fields
    if (!email || !password) {
      activeConnections.delete(user.id);
      return NextResponse.json(
        { 
          error: 'MISSING_CREDENTIALS',
          message: 'Email and password are required'
        },
        { status: 400 }
      );
    }
    
    // Generate unique session ID
    const sessionId = uuidv4();
    
    try {
      // Connect via browser with automated login
      const sessionData = await connectLinkedInViaBrowser(sessionId, email, password);

      // Save session data with extracted profile info
      const savedSession = await sessionManager.saveSession(
        sessionId, 
        email, // Use the provided email
        sessionData.cookies, 
        sessionData.localStorage, 
        sessionData.sessionStorage, 
        sessionData.profileImageUrl, 
        sessionData.userName,
        user.id // Pass user ID for database storage
      );

      // Remove user from active connections (keep internal tracking clean, no noisy logs)
      activeConnections.delete(user.id);

      return NextResponse.json({
        success: true,
        message: 'LinkedIn account connected successfully',
        sessionId,
        accountId: savedSession.id,
        accountName: sessionData.userName,
        debugScreenshots: sessionData.screenshots || [],
      });

    } catch (error) {
      console.error('❌ Error during LinkedIn connection:', error.message);
      
      // Remove user from active connections on error
      activeConnections.delete(user.id);
      
      // Handle specific error types
      const debugScreenshots = error.screenshots || [];

      if (error.message === 'INVALID_CREDENTIALS') {
        return NextResponse.json(
          { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password. Please check your LinkedIn credentials and try again.', debugScreenshots },
          { status: 401 }
        );
      }
      
      if (error.message === '2FA_NOT_SUPPORTED') {
        return NextResponse.json(
          { error: '2FA_NOT_SUPPORTED', message: 'This LinkedIn account has Two-Factor Authentication (2FA) enabled. Please disable 2FA in your LinkedIn security settings and try again.', debugScreenshots },
          { status: 400 }
        );
      }
      
      if (error.message === 'LOGIN_TIMEOUT') {
        return NextResponse.json(
          { error: 'LOGIN_TIMEOUT', message: 'Login process timed out. Please try again.', debugScreenshots },
          { status: 408 }
        );
      }
      
      if (error.message === 'LOGIN_FAILED') {
        return NextResponse.json(
          { error: 'LOGIN_FAILED', message: 'Failed to log in to LinkedIn. Please check your credentials and try again.', debugScreenshots },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { error: 'CONNECTION_ERROR', message: error.message || 'Failed to connect to LinkedIn', debugScreenshots },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ API Error:', error);
    
    // Remove user from active connections on API error
    activeConnections.delete(user.id);
    
    return NextResponse.json(
      { 
        error: 'INTERNAL_ERROR',
        message: 'An internal error occurred'
      },
      { status: 500 }
    );
  }
});
