import { NextResponse } from 'next/server';
import RozeeSessionManager from '@/libs/rozee-session';
import { withAuth } from "@/libs/auth-middleware";

const sessionManager = new RozeeSessionManager();

export const GET = withAuth(async (request, { user }) => {
  try {
    const sharedRoles = ['admin', 'sales_operator', 'recruiter'];
    const sessions = sharedRoles.includes(user.role)
      ? await sessionManager.getAllSessions()
      : await sessionManager.getAllSessions(user.id);

    const accounts = sessions.map((session) => ({
      id: session.sessionId,
      dbId: session.id,
      email: session.email,
      name: session.userName || session.email,
      profileImageUrl: session.profileImageUrl || null,
      isActive: session.isActive || false,
      dailyInvitesSent: session.dailyInvitesSent || 0,
      dailyLimit: session.dailyLimit || 20,
      dailyMessagesSent: session.dailyMessagesSent || 0,
      dailyMessageLimit: session.dailyMessageLimit || 15,
      addedDate: new Date(session.createdAt).toLocaleDateString(),
      tags: session.tags || [],
      lastUsed: session.lastUsed,
    }));

    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    console.error('Error fetching Rozee accounts:', error);
    return NextResponse.json(
      { error: 'FETCH_ERROR', message: 'Failed to fetch Rozee accounts' },
      { status: 500 }
    );
  }
});

export const DELETE = withAuth(async (request) => {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const deleted = await sessionManager.deleteSession(sessionId);
    if (deleted) {
      return NextResponse.json({ success: true, message: 'Rozee account disconnected successfully' });
    }
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  } catch (error) {
    console.error('Error deleting Rozee account:', error);
    return NextResponse.json(
      { error: 'DELETE_ERROR', message: 'Failed to delete Rozee account' },
      { status: 500 }
    );
  }
});
