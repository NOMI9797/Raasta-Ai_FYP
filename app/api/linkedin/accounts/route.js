import { NextResponse } from 'next/server';
import LinkedInSessionManager from '@/libs/linkedin-session';
import { withAuth } from "@/libs/auth-middleware";

const sessionManager = new LinkedInSessionManager();

export const GET = withAuth(async (request, { user }) => {
  try {
    const sessions = await sessionManager.getAllSessions(user.id);
    
    // Transform sessions to account format
    const accounts = sessions.map(session => ({
      id: session.sessionId,
      email: session.email,
      name: session.userName || session.email, // Use actual name, fallback to email
      profileImageUrl: session.profileImageUrl || null,
      isActive: session.isActive || false,
      dailyInvitesSent: session.dailyInvitesSent || 0, // Today's invites sent (for rate limiting)
      connectionInvites: session.connectionInvites || 0, // Cumulative total (legacy stats)
      followUpMessages: session.followUpMessages || 0,
      dailyLimit: session.dailyLimit || 30,
      addedDate: new Date(session.createdAt).toLocaleDateString(),
      tags: session.tags || [],
      salesNavActive: session.salesNavActive || true,
      lastUsed: session.lastUsed
    }));

    return NextResponse.json({
      success: true,
      accounts
    });

  } catch (error) {
    console.error('Error fetching LinkedIn accounts:', error);
    return NextResponse.json(
      { 
        error: 'FETCH_ERROR',
        message: 'Failed to fetch LinkedIn accounts'
      },
      { status: 500 }
    );
  }
});

export const DELETE = withAuth(async (request) => {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const deleted = await sessionManager.deleteSession(sessionId);

    if (deleted) {
      return NextResponse.json({
        success: true,
        message: 'LinkedIn account disconnected successfully'
      });
    } else {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

  } catch (error) {
    console.error('Error deleting LinkedIn account:', error);
    return NextResponse.json(
      { 
        error: 'DELETE_ERROR',
        message: 'Failed to delete LinkedIn account'
      },
      { status: 500 }
    );
  }
});
