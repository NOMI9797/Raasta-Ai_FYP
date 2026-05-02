import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { campaigns, leads, messages, rozeeAccounts } from "@/libs/schema";
import { enrichRozeeLeadInDb } from "@/libs/lead-rozee-enrichment";
import { generateRozeeJobLeadOutreach } from "@/libs/groq-service";

function icpToSummary(icp) {
  if (!icp || typeof icp !== "object") return "";
  try {
    const s = JSON.stringify(icp);
    return s.length > 1800 ? s.slice(0, 1800) + "…" : s;
  } catch {
    return String(icp).slice(0, 1800);
  }
}

function companyResearchToSummary(research) {
  if (!research || typeof research !== "object") return "";
  const website = research.website || {};
  const parts = [
    research.websiteUrl ? `Website URL: ${research.websiteUrl}` : null,
    research.linkedinCompanyUrl ? `LinkedIn company URL: ${research.linkedinCompanyUrl}` : null,
    website.title ? `Site title: ${website.title}` : null,
    website.metaDescription ? `Meta description: ${website.metaDescription}` : null,
    website.h1 ? `H1: ${website.h1}` : null,
    website.aboutSnippet ? `About snippet: ${website.aboutSnippet.slice(0, 1200)}` : null,
    Array.isArray(website.emails) && website.emails.length
      ? `Company-site emails: ${website.emails.join(", ")}`
      : null,
    Array.isArray(website.phones) && website.phones.length
      ? `Company-site phones: ${website.phones.join(", ")}`
      : null,
  ].filter(Boolean);
  return parts.join("\n").slice(0, 2600);
}

function companyProfileToSummary(profile) {
  if (!profile || typeof profile !== "object") return "";
  const parts = [
    profile.companyWebsite ? `Company website: ${profile.companyWebsite}` : null,
    profile.linkedinCompanyUrl ? `LinkedIn company: ${profile.linkedinCompanyUrl}` : null,
    profile.companyIndustry ? `Industry: ${profile.companyIndustry}` : null,
    profile.companySize ? `Company size: ${profile.companySize}` : null,
    profile.companyHeadquarters ? `Headquarters: ${profile.companyHeadquarters}` : null,
    profile.companyFounded ? `Founded: ${profile.companyFounded}` : null,
    profile.companyDescription
      ? `Company description: ${String(profile.companyDescription).slice(0, 1000)}`
      : null,
    Array.isArray(profile.companySpecialties) && profile.companySpecialties.length
      ? `Specialties: ${profile.companySpecialties.join(", ")}`
      : null,
    Array.isArray(profile.companyEmails) && profile.companyEmails.length
      ? `Company emails: ${profile.companyEmails.join(", ")}`
      : null,
    Array.isArray(profile.companyPhones) && profile.companyPhones.length
      ? `Company phones: ${profile.companyPhones.join(", ")}`
      : null,
  ].filter(Boolean);
  return parts.join("\n").slice(0, 2800);
}

/**
 * POST /api/messages/generate-rozee
 * Body: { leadId, customPrompt?, model?, autoEnrich?: boolean (default true) }
 * Creates a draft message from Rozee job + conversion context (enriches first if needed).
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const leadId = body?.leadId;
    const customPrompt = typeof body?.customPrompt === "string" ? body.customPrompt : "";
    const model = body?.model || "llama-3.1-8b-instant";
    const autoEnrich = body?.autoEnrich !== false;

    if (!leadId) {
      return NextResponse.json({ error: "leadId is required" }, { status: 400 });
    }
    console.log(`[ROZEE_MSG] user=${user.id} lead=${leadId} start`);

    let [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (lead.source !== "rozee") {
      return NextResponse.json(
        { error: "Rozee draft messages are only for Rozee.pk leads" },
        { status: 400 }
      );
    }

    let conv = lead.sourceData?.conversion;
    const hasBody = !!(conv?.enrichment?.jobDescription || "").trim();

    if (!hasBody && autoEnrich) {
      console.log(`[ROZEE_MSG] lead=${leadId} autoEnrich=true (missing jobDescription)`);
      const [rozeeAcc] = await db
        .select()
        .from(rozeeAccounts)
        .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
        .limit(1);
      await enrichRozeeLeadInDb(lead, rozeeAcc || {});
      [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
        .limit(1);
      conv = lead.sourceData?.conversion;
    }

    const excerpt =
      (conv?.enrichment?.descriptionExcerpt || conv?.enrichment?.jobDescription || "").trim();
    if (!excerpt) {
      console.warn(`[ROZEE_MSG] lead=${leadId} missing description after enrich`);
      return NextResponse.json(
        {
          error:
            "No job description yet. Enrich the lead first (or connect a Rozee account and retry).",
        },
        { status: 400 }
      );
    }

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, lead.campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    const icpSummary = icpToSummary(campaign?.icpConfig);

    const companyName = (lead.company || lead.name || conv?.enrichment?.pageCompany || "").trim();
    const jobTitle = (lead.title || conv?.enrichment?.pageTitle || "").trim();
    const location =
      (lead.sourceData?.location || conv?.enrichment?.pageLocation || "").trim() || null;
    const skills = conv?.enrichment?.skillsFromJob || [];
    const companyResearchSummary = companyResearchToSummary(
      conv?.enrichment?.companyResearch
    );
    const companyProfileSummary = companyProfileToSummary(
      conv?.enrichment?.companyProfile
    );
    const mergedCompanySummary = [companyResearchSummary, companyProfileSummary]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3500);

    const content = await generateRozeeJobLeadOutreach({
      tier: conv?.tier || "B",
      personalizationMode: conv?.personalizationMode || "job_focused",
      companyName: companyName || "the hiring team",
      jobTitle,
      location,
      jobDescriptionExcerpt: excerpt,
      skills,
      suggestedChannel: conv?.outreach?.primaryChannel || "linkedin",
      companyResearchSummary: mergedCompanySummary,
      icpSummary,
      customPrompt,
      model,
    });

    const [savedMessage] = await db
      .insert(messages)
      .values({
        userId: lead.userId,
        leadId,
        campaignId: lead.campaignId,
        content,
        model,
        customPrompt: customPrompt || null,
        postsAnalyzed: 0,
        source: "rozee",
        status: "draft",
      })
      .returning();
    console.log(
      `[ROZEE_MSG] lead=${leadId} generated tier=${conv?.tier || "-"} channel=${conv?.outreach?.primaryChannel || "-"} chars=${content.length}`
    );

    return NextResponse.json({
      success: true,
      message: savedMessage,
      messageContent: content,
      tier: conv?.tier,
      suggestedChannel: conv?.outreach?.primaryChannel,
    });
  } catch (error) {
    console.error("generate-rozee error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate message" },
      { status: 500 }
    );
  }
});
