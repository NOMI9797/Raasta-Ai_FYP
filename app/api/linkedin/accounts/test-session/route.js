import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import path from 'path';
import LinkedInSessionManager from '@/libs/linkedin-session';
import { withAuth } from "@/libs/auth-middleware";

// Initialize session manager
const sessionManager = new LinkedInSessionManager();

// Test session validity by trying to access LinkedIn with stored session data
async function testLinkedInSession(sessionData) {
  console.log('🧪 Testing LinkedIn session validity...');
  
  // Launch browser with session data
  const context = await chromium.launchPersistentContext(
    path.join(process.cwd(), 'linkedin-test-profiles', sessionData.sessionId),
    {
      headless: true, // Run in headless mode for testing
      viewport: { width: 1280, height: 720 },
    
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
      timeout: 30000 // 30 seconds timeout
    });

    // Wait a bit for page to load
    await page.waitForTimeout(3000);

    // Check current URL to see if we're logged in
    const currentUrl = page.url();
    console.log(`📍 Current URL after navigation: ${currentUrl}`);

    // Check if we're redirected to login page (session invalid)
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

    // Check if we successfully reached feed or other authenticated pages
    if (currentUrl.includes('linkedin.com/feed') || 
        currentUrl.includes('linkedin.com/in/') ||
        currentUrl.includes('linkedin.com/mynetwork/') ||
        currentUrl.includes('linkedin.com/messaging/')) {
      
      // Try to get user profile info to confirm we're logged in
      let profileInfo = null;
      try {
        // Try to find user profile elements
        const profileElements = await page.$$('img[alt*="profile"], .profile-photo, [data-control-name="identity_profile_photo"]');
        if (profileElements.length > 0) {
          profileInfo = 'Profile elements found';
        }
      } catch (error) {
        console.log('⚠️ Could not verify profile elements, but URL suggests valid session');
      }

      console.log('✅ Session is valid - successfully accessed authenticated page');
      await context.close();
      return {
        isValid: true,
        reason: 'Successfully accessed LinkedIn authenticated page',
        currentUrl,
        profileInfo
      };
    }

    // If we reach here, we're on an unexpected page
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
}

export const POST = withAuth(async (request, { user }) => {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Testing session validity for session: ${sessionId}`);

    // Load session data from database
    const sessionData = await sessionManager.loadSession(sessionId);
    
    if (!sessionData) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Check if session belongs to the authenticated user
    if (sessionData.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - session does not belong to user' },
        { status: 403 }
      );
    }

    // Check if session is active
    if (!sessionData.isActive) {
      return NextResponse.json(
        { error: 'Session is not active' },
        { status: 400 }
      );
    }

    // Test the session
    const testResult = await testLinkedInSession(sessionData);

    // Update session status based on test result
    if (!testResult.isValid) {
      // Mark session as inactive if it's invalid
      await sessionManager.updateSessionStatus(sessionId, { 
        isActive: false 
      });
      console.log('🔄 Marked invalid session as inactive');
    }

    return NextResponse.json({
      success: true,
      sessionId,
      isValid: testResult.isValid,
      reason: testResult.reason,
      currentUrl: testResult.currentUrl,
      profileInfo: testResult.profileInfo,
      testedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        error: 'INTERNAL_ERROR',
        message: 'An internal error occurred while testing session'
      },
      { status: 500 }
    );
  }
});
