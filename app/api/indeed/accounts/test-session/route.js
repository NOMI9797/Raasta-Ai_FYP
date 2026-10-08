import { NextResponse } from 'next/server';
import IndeedSessionManager from '@/libs/indeed-session';
import { withAuth } from "@/libs/auth-middleware";
import { testIndeedSession } from '@/libs/indeed-session-validator';

const sessionManager = new IndeedSessionManager();

export const POST = withAuth(async (request, { user }) => {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const sessionData = await sessionManager.loadSession(sessionId);
    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (sessionData.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - session does not belong to user' },
        { status: 403 }
      );
    }

    const testResult = await testIndeedSession(sessionData);
    if (!testResult.isValid) {
      await sessionManager.updateSessionStatus(sessionId, { isActive: false });
    }

    return NextResponse.json({
      success: true,
      sessionId,
      isValid: testResult.isValid,
      challenge: Boolean(testResult.challenge),
      reason: testResult.reason,
      currentUrl: testResult.currentUrl,
      testedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error testing Indeed session:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'An internal error occurred while testing session' },
      { status: 500 }
    );
  }
}, { requireUser: true });
