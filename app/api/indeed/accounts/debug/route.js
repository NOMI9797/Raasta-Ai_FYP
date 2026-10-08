import { NextResponse } from 'next/server';
import IndeedSessionManager from '@/libs/indeed-session';
import { withAuth } from "@/libs/auth-middleware";
import { DiagnoseError, diagnoseIndeed } from '@/libs/indeed-diagnose';
import { debugEnabled, listDebugRuns } from '@/libs/indeed-debug';

const sessionManager = new IndeedSessionManager();

// GET  recent debug runs (diagnostics and, with INDEED_DEBUG=true, every publish attempt) and whether publish debugging is on
// POST { sessionId, visible? } runs the read-only diagnostic for one of the person's own accounts

export const GET = withAuth(async () => {
  return NextResponse.json({ success: true, publishDebugging: debugEnabled(), runs: await listDebugRuns() });
}, { requireUser: true });

export const POST = withAuth(async (request, { user }) => {
  try {
    const { sessionId, visible } = await request.json().catch(() => ({}));
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const account = await sessionManager.loadSession(sessionId);
    if (!account) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (account.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized - session does not belong to user' }, { status: 403 });
    }

    const result = await diagnoseIndeed(account, { visible: visible === true });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof DiagnoseError) {
      const status = error.code === 'busy' ? 409 : error.code === 'too_soon' ? 429 : 501;
      return NextResponse.json({ error: error.code, message: error.message }, { status });
    }
    console.error('Error running Indeed diagnostic:', error.message);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'The diagnostic could not run' }, { status: 500 });
  }
}, { requireUser: true });
