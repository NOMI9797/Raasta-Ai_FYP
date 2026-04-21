import { NextResponse } from 'next/server';
import { withAuth } from '@/libs/auth-middleware';
import { db } from '@/libs/db';
import { rozeeAccounts, leads, messages } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import { getAdapter } from '@/libs/platforms';

/**
 * Send an in-platform Rozee.pk message to a profile.
 *
 * Body: { profileUrl?: string, leadId?: string, message: string, campaignId?: string }
 *   - If leadId is provided we look up the lead to fetch its url + campaign.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const { profileUrl, leadId, message, campaignId } = await request.json();
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    let targetUrl = profileUrl;
    let lead = null;
    if (leadId) {
      const [row] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
        .limit(1);
      if (!row) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }
      lead = row;
      targetUrl = targetUrl || row.url;
    }

    if (!targetUrl) {
      return NextResponse.json({ error: 'profileUrl or leadId is required' }, { status: 400 });
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

    const adapter = getAdapter('rozee');

    const limit = await adapter.rateLimit.checkMessages(account.id);
    if (!limit.canSend) {
      return NextResponse.json(
        {
          error: 'DAILY_LIMIT_REACHED',
          message: `Daily message limit reached for Rozee account (${limit.sent}/${limit.limit}).`,
        },
        { status: 429 }
      );
    }

    const result = await adapter.sendMessage(account, {
      leadUrl: targetUrl,
      message,
      leadName: lead?.name || 'Candidate',
    });

    if (!result?.success) {
      if (lead) {
        await db.update(leads).set({ messageError: result?.error || null }).where(eq(leads.id, lead.id));
      }
      return NextResponse.json({ error: result?.error || 'Failed to send Rozee message' }, { status: 500 });
    }

    await adapter.rateLimit.incrementMessages(account.id);

    if (lead) {
      await db
        .update(leads)
        .set({ messageSent: true, messageSentAt: new Date(), messageError: null })
        .where(eq(leads.id, lead.id));

      if (campaignId || lead.campaignId) {
        await db.insert(messages).values({
          userId: user.id,
          leadId: lead.id,
          campaignId: campaignId || lead.campaignId,
          content: message,
          status: 'sent',
          source: 'rozee',
          sentAt: new Date(),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Rozee send message error:', error);
    return NextResponse.json({ error: error.message || 'Failed to send Rozee message' }, { status: 500 });
  }
});
