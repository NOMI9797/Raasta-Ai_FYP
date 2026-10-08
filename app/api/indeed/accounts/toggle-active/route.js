import { NextResponse } from 'next/server';
import IndeedSessionManager from '@/libs/indeed-session';
import { withAuth } from "@/libs/auth-middleware";

const sessionManager = new IndeedSessionManager();

export const POST = withAuth(async (request, { user }) => {
  try {
    const { accountId, isActive } = await request.json();
    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    const updated = await sessionManager.toggleAccountStatus(user.id, accountId, Boolean(isActive));
    if (!updated) {
      return NextResponse.json(
        { error: 'Account not found or failed to update' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: isActive ? 'Account activated' : 'Account deactivated',
      accountId,
      isActive: Boolean(isActive),
    });
  } catch (error) {
    console.error('Error toggling Indeed account status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}, { requireUser: true });
