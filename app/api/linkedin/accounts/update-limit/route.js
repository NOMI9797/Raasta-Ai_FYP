import { NextResponse } from 'next/server';
import { withAuth } from "@/libs/auth-middleware";
import { db } from '@/libs/db';
import { linkedinAccounts } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';

const MAX_DAILY_LIMIT = 30; // System-wide maximum

export const POST = withAuth(async (request, { user }) => {
  try {
    const { accountId, dailyLimit } = await request.json();

    // Validation
    if (!accountId) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      );
    }

    if (typeof dailyLimit !== 'number' || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) {
      return NextResponse.json(
        { error: `Daily limit must be between 1 and ${MAX_DAILY_LIMIT}` },
        { status: 400 }
      );
    }

    // Update daily limit
    // Note: accountId is the database UUID (id), not sessionId
    const [updated] = await db
      .update(linkedinAccounts)
      .set({ 
        dailyLimit,
        updatedAt: new Date()
      })
      .where(and(
        eq(linkedinAccounts.id, accountId), // Use id (UUID) not sessionId
        eq(linkedinAccounts.userId, user.id) // Ensure user owns this account
      ))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: 'Account not found or unauthorized' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Daily limit updated to ${dailyLimit}`,
      accountId,
      dailyLimit: updated.dailyLimit
    });

  } catch (error) {
    console.error('Error updating daily limit:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

