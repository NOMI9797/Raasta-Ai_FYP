import { NextResponse } from 'next/server';
import IndeedSessionManager from '@/libs/indeed-session';
import { withAuth } from "@/libs/auth-middleware";

const sessionManager = new IndeedSessionManager();

// Operators share the connected accounts (same as LinkedIn and Rozee.pk): the list shows all of them,
// but only the person who connected an account (or an admin) can remove it.
const SHARED_ROLES = ['admin', 'sales_operator', 'recruiter'];

export const GET = withAuth(async (request, { user }) => {
  try {
    const sessions = SHARED_ROLES.includes(user.role)
      ? await sessionManager.getAllSessions()
      : await sessionManager.getAllSessions(user.id);

    const accounts = sessions.map((session) => ({
      id: session.sessionId,
      dbId: session.id,
      email: session.email,
      name: session.userName || session.email,
      profileImageUrl: session.profileImageUrl || null,
      isActive: session.isActive || false,
      own: session.userId === user.id,
      addedDate: new Date(session.createdAt).toLocaleDateString(),
      tags: session.tags || [],
      lastUsed: session.lastUsed,
    }));

    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    console.error('Error fetching Indeed accounts:', error);
    return NextResponse.json(
      { error: 'FETCH_ERROR', message: 'Failed to fetch Indeed accounts' },
      { status: 500 }
    );
  }
}, { requireUser: true });

export const DELETE = withAuth(async (request, { user }) => {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const deleted = await sessionManager.deleteSession(sessionId, user.role === 'admin' ? null : user.id);
    if (deleted) {
      return NextResponse.json({ success: true, message: 'Indeed account disconnected successfully' });
    }
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  } catch (error) {
    console.error('Error deleting Indeed account:', error);
    return NextResponse.json(
      { error: 'DELETE_ERROR', message: 'Failed to delete Indeed account' },
      { status: 500 }
    );
  }
}, { requireUser: true });
