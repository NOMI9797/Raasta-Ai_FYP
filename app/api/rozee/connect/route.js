import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import RozeeSessionManager from '@/libs/rozee-session';
import { withAuth } from "@/libs/auth-middleware";
import {
  DEFAULT_BROWSER_ARGS,
  humanLikeDelay,
  simulateHumanBehavior,
  captureScreenshot,
  captureSessionFromContext,
  urlMatchesPatterns,
} from '@/libs/playwright-utils';

const sessionManager = new RozeeSessionManager();

const activeConnections = new Set();

const ROZEE_PATTERNS = {
  SUCCESS: ['rozee.pk/my/', 'rozee.pk/dashboard', 'rozee.pk/account'],
  INTERMEDIATE: ['rozee.pk/checkpoint', 'rozee.pk/verify', 'rozee.pk/otp'],
  LOGIN: ['rozee.pk/user/login', 'rozee.pk/login'],
  // Rozee now sends unknown/auth-required paths to this "Not Found" shell
  // with ?e=login. We detect it so we can fail fast with a clear message
  // instead of hanging for 10s on the input selector.
  ERROR_SHELL: ['rozee.pk/site/error'],
};

const ROZEE_LOGIN_URL = 'https://www.rozee.pk/login';

async function connectRozeeViaBrowser(sessionId, email, password) {
  const screenshots = [];
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: true,
    slowMo: 1000,
    args: DEFAULT_BROWSER_ARGS,
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(ROZEE_LOGIN_URL);
    await page.waitForLoadState('domcontentloaded');
    await humanLikeDelay(page, 2000, 4000);
    await simulateHumanBehavior(page);
    screenshots.push(await captureScreenshot(page, 'Login page loaded'));

    // Rozee sometimes responds to unknown paths with a "Not Found" shell at
    // /site/error?e=login. If that happens, the login form doesn't exist on
    // the page, so bail out immediately instead of waiting 10s for a selector
    // that will never appear.
    if (urlMatchesPatterns(page.url(), ROZEE_PATTERNS.ERROR_SHELL)) {
      throw new Error('LOGIN_URL_UNREACHABLE');
    }

    // Rozee's real login form (as of 2026) uses these names:
    //   email:    <input id="_email" name="username_or_email" type="text">
    //   password: <input id="pwd"    name="password"          type="password">
    // We keep the older selectors as fallbacks in case Rozee renames things
    // again, so we don't break if either set works.
    const emailField = page.locator(
      "input[name='username_or_email'], input#_email, input[name='username'], input[name='email'], input[type='email'], input#username"
    ).first();
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.click();
    await humanLikeDelay(page, 500, 1000);
    await emailField.fill(email);
    await humanLikeDelay(page, 500, 1000);

    const passwordField = page.locator(
      "input[name='password'], input#pwd, input[type='password'], input#password"
    ).first();
    await passwordField.waitFor({ state: 'visible', timeout: 10000 });
    await passwordField.click();
    await humanLikeDelay(page, 500, 1000);
    await passwordField.fill(password);
    await humanLikeDelay(page, 1000, 2000);
    screenshots.push(await captureScreenshot(page, 'Credentials filled'));

    // Rozee has TWO submit buttons in the DOM — one inside the top nav search
    // form (class="btn btn-primary", always hidden) and the real login button
    // (id="submit_button" inside #login-form). Playwright's `.first()` on a
    // broad selector always matches the hidden search button first, causing a
    // 10s waitFor timeout. Use the specific id / scoped selector instead.
    const signInButton = page.locator(
      "#submit_button, #login-form button[type='submit'], #login-form input[type='submit']"
    ).first();
    await signInButton.waitFor({ state: 'visible', timeout: 10000 });
    await signInButton.click();

    await humanLikeDelay(page, 3000, 5000);
    screenshots.push(await captureScreenshot(page, 'After submit'));

    let loginCompleted = false;
    let attempts = 0;
    const maxAttempts = 20;

    while (!loginCompleted && attempts < maxAttempts) {
      const currentUrl = page.url();
      const isSuccess = urlMatchesPatterns(currentUrl, ROZEE_PATTERNS.SUCCESS);
      const isIntermediate = urlMatchesPatterns(currentUrl, ROZEE_PATTERNS.INTERMEDIATE);
      const isLogin = urlMatchesPatterns(currentUrl, ROZEE_PATTERNS.LOGIN);

      if (isIntermediate) {
        screenshots.push(await captureScreenshot(page, 'Intermediate / OTP page'));
        throw new Error('2FA_NOT_SUPPORTED');
      }

      if (isSuccess) {
        screenshots.push(await captureScreenshot(page, 'Login successful'));
        loginCompleted = true;
        break;
      }

      if (isLogin && attempts > 4) {
        const errorText = await page
          .locator('.error, .alert-danger, .form-error, [class*="error"]')
          .first()
          .textContent()
          .catch(() => null);
        screenshots.push(await captureScreenshot(page, 'Login still on login page'));
        if (errorText && /password|credential|invalid/i.test(errorText)) {
          throw new Error('INVALID_CREDENTIALS');
        }
        throw new Error('LOGIN_FAILED');
      }

      await page.waitForTimeout(4000);
      attempts++;
    }

    if (!loginCompleted) {
      screenshots.push(await captureScreenshot(page, 'Login timeout'));
      throw new Error('LOGIN_TIMEOUT');
    }

    await humanLikeDelay(page, 2000, 4000);

    const { cookies, localStorage, sessionStorage } = await captureSessionFromContext(context, page);
    const userName = email;
    const profileImageUrl = null;

    screenshots.push(await captureScreenshot(page, 'Session captured'));

    await context.close();
    await browser.close();

    return { cookies, localStorage, sessionStorage, userName, profileImageUrl, screenshots };
  } catch (error) {
    try {
      screenshots.push(await captureScreenshot(page, `Error state — ${error.message}`));
    } catch (screenshotErr) {
      console.warn('Screenshot capture failed during error handling', screenshotErr);
    }
    await context.close();
    await browser.close();
    error.screenshots = screenshots;
    throw error;
  }
}

export const POST = withAuth(async (request, { user }) => {
  try {
    if (activeConnections.has(user.id)) {
      return NextResponse.json(
        { error: 'CONNECTION_IN_PROGRESS', message: 'A Rozee connection is already in progress for this user.' },
        { status: 409 }
      );
    }
    activeConnections.add(user.id);

    const { email, password } = await request.json();
    if (!email || !password) {
      activeConnections.delete(user.id);
      return NextResponse.json(
        { error: 'MISSING_CREDENTIALS', message: 'Email and password are required' },
        { status: 400 }
      );
    }

    const sessionId = uuidv4();
    try {
      const sessionData = await connectRozeeViaBrowser(sessionId, email, password);
      const savedSession = await sessionManager.saveSession(
        sessionId,
        email,
        sessionData.cookies,
        sessionData.localStorage,
        sessionData.sessionStorage,
        sessionData.profileImageUrl,
        sessionData.userName,
        user.id
      );

      activeConnections.delete(user.id);

      return NextResponse.json({
        success: true,
        message: 'Rozee account connected successfully',
        sessionId,
        accountId: savedSession.id,
        accountName: sessionData.userName,
        debugScreenshots: sessionData.screenshots || [],
      });
    } catch (error) {
      activeConnections.delete(user.id);
      const debugScreenshots = error.screenshots || [];

      const map = {
        INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password.' },
        '2FA_NOT_SUPPORTED': { status: 400, message: 'This Rozee account requires verification (OTP/2FA) which is not supported.' },
        LOGIN_TIMEOUT: { status: 408, message: 'Login process timed out. Please try again.' },
        LOGIN_FAILED: { status: 401, message: 'Failed to log in to Rozee. Please check your credentials.' },
        LOGIN_URL_UNREACHABLE: {
          status: 502,
          message:
            "Rozee's login page is unreachable (site may be down or the URL changed). Please try again in a few minutes.",
        },
      };

      const matched = map[error.message];
      if (matched) {
        return NextResponse.json(
          { error: error.message, message: matched.message, debugScreenshots },
          { status: matched.status }
        );
      }

      return NextResponse.json(
        { error: 'CONNECTION_ERROR', message: error.message || 'Failed to connect to Rozee', debugScreenshots },
        { status: 500 }
      );
    }
  } catch (error) {
    activeConnections.delete(user.id);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'An internal error occurred' },
      { status: 500 }
    );
  }
});
