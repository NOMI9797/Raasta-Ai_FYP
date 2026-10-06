// The lead a request may see: admins see every lead, others only their own. Relative imports only.
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, leads } from "../../schema";

/** { lead, campaignName } or null */
export async function ownedLead(leadId, user, { database = db } = {}) {
  const conditions = [eq(leads.id, leadId)];
  if (user.role !== "admin") conditions.push(eq(leads.userId, user.id));
  const [row] = await database.select({ lead: leads, campaignName: campaigns.name }).from(leads)
    .leftJoin(campaigns, eq(campaigns.id, leads.campaignId)).where(and(...conditions)).limit(1);
  return row || null;
}
