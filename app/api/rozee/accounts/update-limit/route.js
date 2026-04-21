import { NextResponse } from 'next/server';
import { withAuth } from "@/libs/auth-middleware";
import { db } from '@/libs/db';
import { rozeeAccounts } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';

const MAX_DAILY_LIMIT = 30;
const MAX_MESSAGE_LIMIT = 30;

export const POST = withAuth(async (request, { user }) => {
  try {
    const { accountId, dailyLimit, dailyMessageLimit } = await request.json();

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    const updates = { updatedAt: new Date() };

    if (dailyLimit !== undefined) {
      if (typeof dailyLimit !== 'number' || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) {
        return NextResponse.json(
          { error: `Daily apply limit must be between 1 and ${MAX_DAILY_LIMIT}` },
          { status: 400 }
        );
      }
      updates.dailyLimit = dailyLimit;
    }

    if (dailyMessageLimit !== undefined) {
      if (typeof dailyMessageLimit !== 'number' || dailyMessageLimit < 1 || dailyMessageLimit > MAX_MESSAGE_LIMIT) {
        return NextResponse.json(
          { error: `Daily message limit must be between 1 and ${MAX_MESSAGE_LIMIT}` },
          { status: 400 }
        );
      }
      updates.dailyMessageLimit = dailyMessageLimit;
    }

    const [updated] = await db
      .update(rozeeAccounts)
      .set(updates)
      .where(and(
        eq(rozeeAccounts.id, accountId),
        eq(rozeeAccounts.userId, user.id)
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Account not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      accountId,
      dailyLimit: updated.dailyLimit,
      dailyMessageLimit: updated.dailyMessageLimit,
    });
  } catch (error) {
    console.error('Error updating Rozee daily limits:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
