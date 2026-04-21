import { NextResponse } from 'next/server';
import { withAuth } from '@/libs/auth-middleware';
import { db } from '@/libs/db';
import { rozeeAccounts } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import RozeeSessionManager from '@/libs/rozee-session';
import { applyToRozeeJob } from '@/libs/rozee-auto-applier';
import {
  checkDailyLimitForPlatform,
  incrementDailyCounterForPlatform,
} from '@/libs/rate-limit-manager';

const sessionManager = new RozeeSessionManager();

/**
 * Auto-apply to a Rozee.pk job listing using the user's active Rozee account.
 *
 * Body: { jobUrl: string, coverLetter?: string }
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const { jobUrl, coverLetter } = await request.json();
    if (!jobUrl) {
      return NextResponse.json({ error: 'jobUrl is required' }, { status: 400 });
    }

    const [account] = await db
      .select()
      .from(rozeeAccounts)
      .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
      .limit(1);
    if (!account) {
      return NextResponse.json(
        { error: 'No active Rozee account. Connect and activate a Rozee account first.' },
        { status: 400 }
      );
    }

    const limit = await checkDailyLimitForPlatform(account.id, 'rozee');
    if (!limit.canSend) {
      return NextResponse.json(
        {
          error: 'DAILY_LIMIT_REACHED',
          message: `Daily apply limit reached for Rozee account (${limit.sent}/${limit.limit}). Resets at ${limit.resetsAt}.`,
        },
        { status: 429 }
      );
    }

    const sessionData = await sessionManager.loadSession(account.sessionId);
    const result = await applyToRozeeJob({ jobUrl, sessionData, coverLetter });

    if (result.success) {
      await incrementDailyCounterForPlatform(account.id, 'rozee', 1);
    }

    return NextResponse.json({
      success: result.success,
      status: result.status,
      error: result.error,
    });
  } catch (error) {
    console.error('Rozee apply error:', error);
    return NextResponse.json({ error: error.message || 'Failed to apply on Rozee' }, { status: 500 });
  }
});
