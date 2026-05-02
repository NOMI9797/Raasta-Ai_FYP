"use client";

import { useEffect, memo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  MessageCircle,
  Repeat2,
  Calendar,
  Loader2,
  TrendingUp,
  Eye,
  Briefcase,
  GraduationCap,
  Sparkles,
  Mail,
} from "lucide-react";
import { usePosts } from "../hooks/usePosts";
import { isRozeeJobPostingUrl } from "@/libs/platform-urls";

function RozeeJobLeadCard({ lead }) {
  const conv = lead?.sourceData?.conversion;
  const enr = conv?.enrichment;
  const outreach = conv?.outreach;
  const evidence = enr?.evidence || {};
  const companyResearch = enr?.companyResearch || null;
  const websiteResearch = companyResearch?.website || null;
  const companyProfile = enr?.companyProfile || null;

  if (!enr?.enrichedAt) {
    return (
      <div className="p-4 text-center text-base-content/60">
        <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Job not enriched yet</p>
        <p className="text-xs">Click &quot;Run Selected&quot; or &quot;Run All&quot; to pull job details, tier, and outreach hints</p>
      </div>
    );
  }

  const skills = Array.isArray(enr.skillsFromJob) ? enr.skillsFromJob : [];
  const emails = Array.isArray(outreach?.emailsFound) ? outreach.emailsFound : [];
  const socialLinks = Array.isArray(outreach?.socialLinks) ? outreach.socialLinks : [];
  const externalLinks = Array.isArray(outreach?.externalLinks) ? outreach.externalLinks : [];
  const signalList = Array.isArray(evidence?.signalsMatched) ? evidence.signalsMatched : [];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base-content">{lead.title || enr.pageTitle || "Role"}</h3>
            {conv?.tier && (
              <span className="badge badge-sm badge-primary">Tier {conv.tier}</span>
            )}
            {typeof conv?.score === "number" && (
              <span className="badge badge-sm badge-outline">Score {conv.score}</span>
            )}
          </div>
          <p className="text-sm text-base-content/70 mt-1">
            {(lead.name || lead.company || enr.pageCompany || "Company") +
              (lead.sourceData?.location || enr.pageLocation
                ? ` · ${lead.sourceData?.location || enr.pageLocation}`
                : "")}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle shrink-0"
          onClick={() => window.open(lead.url, "_blank")}
          title="Open job on Rozee"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {outreach?.primaryChannel && (
        <div className="text-xs rounded-lg bg-base-200 border border-base-300 p-2">
          <span className="font-medium">Suggested channel:</span>{" "}
          <span className="capitalize">{outreach.primaryChannel}</span>
          {outreach.note ? ` — ${outreach.note}` : ""}
        </div>
      )}

      {skills.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Skills / stack
          </div>
          <div className="flex flex-wrap gap-1.5">
            {skills.slice(0, 24).map((s, i) => (
              <span key={`${s}-${i}`} className="badge badge-outline badge-sm">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {enr.descriptionExcerpt && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            Job context (for messaging)
          </div>
          <p className="text-sm text-base-content/80 whitespace-pre-line leading-relaxed max-h-64 overflow-y-auto">
            {enr.descriptionExcerpt}
            {enr.jobDescription && enr.jobDescription.length > (enr.descriptionExcerpt?.length || 0)
              ? "…"
              : ""}
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          Scraped proof / evidence
        </div>
        <div className="space-y-2 text-xs">
          <div className="rounded-lg bg-base-200 border border-base-300 p-2">
            <span className="font-medium">Description analyzed:</span>{" "}
            {typeof evidence.descriptionLength === "number" ? `${evidence.descriptionLength} chars` : "—"}
          </div>

          <div className="rounded-lg bg-base-200 border border-base-300 p-2">
            <div className="font-medium mb-1">Emails found</div>
            {emails.length ? (
              <div className="flex flex-wrap gap-1.5">
                {emails.map((e) => (
                  <a key={e} href={`mailto:${e}`} className="badge badge-outline badge-sm">
                    {e}
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-base-content/60">No email found</div>
            )}
          </div>

          <div className="rounded-lg bg-base-200 border border-base-300 p-2">
            <div className="font-medium mb-1">Profiles / social links</div>
            {socialLinks.length ? (
              <div className="space-y-1">
                {socialLinks.map((u, i) => (
                  <a key={`${u}-${i}`} href={u} target="_blank" rel="noopener noreferrer" className="block truncate link link-hover">
                    {u}
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-base-content/60">No social/profile links found</div>
            )}
          </div>

          <div className="rounded-lg bg-base-200 border border-base-300 p-2">
            <div className="font-medium mb-1">Other external links</div>
            {externalLinks.length ? (
              <div className="space-y-1">
                {externalLinks.map((u, i) => (
                  <a key={`${u}-${i}`} href={u} target="_blank" rel="noopener noreferrer" className="block truncate link link-hover">
                    {u}
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-base-content/60">No external links found</div>
            )}
          </div>

          <div className="rounded-lg bg-base-200 border border-base-300 p-2">
            <div className="font-medium mb-1">Scoring signals matched</div>
            {signalList.length ? (
              <div className="flex flex-wrap gap-1.5">
                {signalList.map((s) => (
                  <span key={s} className="badge badge-outline badge-sm">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-base-content/60">No signals</div>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
          <Briefcase className="h-4 w-4 text-emerald-600" />
          Company research (visited)
        </div>
        {companyResearch || companyProfile ? (
          <div className="space-y-2 text-xs">
            <div className="rounded-lg bg-base-200 border border-base-300 p-2">
              <div className="font-medium mb-1">Visited links</div>
              {companyResearch.websiteUrl ? (
                <a
                  href={companyResearch.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate link link-hover"
                >
                  Website: {companyResearch.websiteUrl}
                </a>
              ) : (
                <div className="text-base-content/60">No company website URL found</div>
              )}
              {companyResearch.linkedinCompanyUrl && (
                <a
                  href={companyResearch.linkedinCompanyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate link link-hover mt-1"
                >
                  LinkedIn: {companyResearch.linkedinCompanyUrl}
                </a>
              )}
            </div>

            {websiteResearch ? (
              <>
                {(websiteResearch.title || websiteResearch.h1 || websiteResearch.metaDescription) && (
                  <div className="rounded-lg bg-base-200 border border-base-300 p-2">
                    <div className="font-medium mb-1">Website summary</div>
                    {websiteResearch.title && (
                      <div className="truncate"><span className="font-medium">Title:</span> {websiteResearch.title}</div>
                    )}
                    {websiteResearch.h1 && (
                      <div className="truncate"><span className="font-medium">H1:</span> {websiteResearch.h1}</div>
                    )}
                    {websiteResearch.metaDescription && (
                      <p className="mt-1 text-base-content/80 whitespace-pre-line">
                        {websiteResearch.metaDescription}
                      </p>
                    )}
                  </div>
                )}

                {websiteResearch.aboutSnippet && (
                  <div className="rounded-lg bg-base-200 border border-base-300 p-2">
                    <div className="font-medium mb-1">About / business context</div>
                    <p className="text-base-content/80 whitespace-pre-line max-h-44 overflow-y-auto">
                      {websiteResearch.aboutSnippet}
                    </p>
                  </div>
                )}

                <div className="rounded-lg bg-base-200 border border-base-300 p-2">
                  <div className="font-medium mb-1">Company contacts found</div>
                  {Array.isArray(websiteResearch.emails) && websiteResearch.emails.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {websiteResearch.emails.map((e) => (
                        <a key={e} href={`mailto:${e}`} className="badge badge-outline badge-sm">
                          {e}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="text-base-content/60">No company-site emails found</div>
                  )}
                  {Array.isArray(websiteResearch.phones) && websiteResearch.phones.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {websiteResearch.phones.map((p, i) => (
                        <span key={`${p}-${i}`} className="badge badge-outline badge-sm">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-base-200 border border-base-300 p-2 text-base-content/60">
                Could not read company website content (site blocked, JS-heavy, or no accessible link).
              </div>
            )}

            {companyProfile && (
              <>
                <div className="rounded-lg bg-base-200 border border-base-300 p-2">
                  <div className="font-medium mb-1">Advanced company profile</div>
                  {companyProfile.companyWebsite && (
                    <a
                      href={companyProfile.companyWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate link link-hover"
                    >
                      Website: {companyProfile.companyWebsite}
                    </a>
                  )}
                  {companyProfile.linkedinCompanyUrl && (
                    <a
                      href={companyProfile.linkedinCompanyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate link link-hover mt-1"
                    >
                      LinkedIn company: {companyProfile.linkedinCompanyUrl}
                    </a>
                  )}
                  {companyProfile.companyIndustry && (
                    <div className="mt-1">
                      <span className="font-medium">Industry:</span> {companyProfile.companyIndustry}
                    </div>
                  )}
                  {companyProfile.companySize && (
                    <div>
                      <span className="font-medium">Size:</span> {companyProfile.companySize}
                    </div>
                  )}
                  {companyProfile.companyHeadquarters && (
                    <div>
                      <span className="font-medium">HQ:</span> {companyProfile.companyHeadquarters}
                    </div>
                  )}
                  {companyProfile.companyFounded && (
                    <div>
                      <span className="font-medium">Founded:</span> {companyProfile.companyFounded}
                    </div>
                  )}
                </div>

                {(companyProfile.companyDescription || (companyProfile.companySpecialties || []).length > 0) && (
                  <div className="rounded-lg bg-base-200 border border-base-300 p-2">
                    <div className="font-medium mb-1">Business summary</div>
                    {companyProfile.companyDescription && (
                      <p className="text-base-content/80 whitespace-pre-line max-h-44 overflow-y-auto">
                        {companyProfile.companyDescription}
                      </p>
                    )}
                    {Array.isArray(companyProfile.companySpecialties) &&
                      companyProfile.companySpecialties.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {companyProfile.companySpecialties.slice(0, 20).map((s, i) => (
                            <span key={`${s}-${i}`} className="badge badge-outline badge-sm">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                {(Array.isArray(companyProfile.companyEmails) && companyProfile.companyEmails.length > 0) ||
                (Array.isArray(companyProfile.companyPhones) && companyProfile.companyPhones.length > 0) ? (
                  <div className="rounded-lg bg-base-200 border border-base-300 p-2">
                    <div className="font-medium mb-1">Advanced contacts</div>
                    {Array.isArray(companyProfile.companyEmails) &&
                      companyProfile.companyEmails.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {companyProfile.companyEmails.map((e) => (
                            <a key={e} href={`mailto:${e}`} className="badge badge-outline badge-sm">
                              {e}
                            </a>
                          ))}
                        </div>
                      )}
                    {Array.isArray(companyProfile.companyPhones) &&
                      companyProfile.companyPhones.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {companyProfile.companyPhones.map((p, i) => (
                            <span key={`${p}-${i}`} className="badge badge-outline badge-sm">
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-base-200 border border-base-300 p-2 text-xs text-base-content/60">
            Company research not available yet. Run enrichment again to visit and analyze company links.
          </div>
        )}
      </div>
    </div>
  );
}

function RozeeCandidateCard({ lead }) {
  const data = lead?.sourceData || {};
  const skills = Array.isArray(data.skills) ? data.skills : [];

  const empty =
    !lead?.name &&
    !lead?.title &&
    !skills.length &&
    !data.experience &&
    !data.education &&
    !data.email;

  if (empty) {
    return (
      <div className="p-4 text-center text-base-content/60">
        <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Candidate not scraped yet</p>
        <p className="text-xs">Click &quot;Run Selected&quot; to fetch the Rozee profile</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Identity */}
      <div className="flex items-start gap-3">
        {lead.profilePicture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lead.profilePicture}
            alt={lead.name || "Candidate"}
            className="w-14 h-14 rounded-full object-cover border border-base-300"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-emerald-600 text-white flex items-center justify-center text-lg font-semibold">
            {(lead.name || "C").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base-content truncate">
              {lead.name || "Rozee Candidate"}
            </h3>
            <button
              className="btn btn-ghost btn-xs btn-circle"
              onClick={() => window.open(lead.url, "_blank")}
              title="Open Rozee profile"
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
          {lead.title && (
            <p className="text-sm text-base-content/70 truncate">{lead.title}</p>
          )}
          {data.email && (
            <div className="flex items-center gap-1 text-xs text-base-content/60 mt-1">
              <Mail className="h-3 w-3" />
              <span className="truncate">{data.email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Skills
            <span className="badge badge-sm">{skills.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {skills.slice(0, 30).map((s, i) => (
              <span key={`${s}-${i}`} className="badge badge-outline badge-sm">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Experience */}
      {data.experience && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
            <Briefcase className="h-4 w-4 text-emerald-600" />
            Experience
          </div>
          <p className="text-sm text-base-content/80 whitespace-pre-line leading-relaxed">
            {data.experience}
          </p>
        </div>
      )}

      {/* Education */}
      {data.education && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
            <GraduationCap className="h-4 w-4 text-emerald-600" />
            Education
          </div>
          <p className="text-sm text-base-content/80 whitespace-pre-line leading-relaxed">
            {data.education}
          </p>
        </div>
      )}
    </div>
  );
}

const PostsColumn = memo(function PostsColumn({ selectedLead, collapsed, onToggleCollapse, onOpenSettings }) {
  const {
    posts,
    isLoading,
    lastFetched,
    fetchPosts,
    formatTimestamp,
    formatNumber,
    calculateEngagement,
  } = usePosts();

  const source = selectedLead?.source || "linkedin";
  const isRozee = source === "rozee";
  const isRozeeJob = isRozee && selectedLead?.url && isRozeeJobPostingUrl(selectedLead.url);

  useEffect(() => {
    // Only LinkedIn leads have a posts feed to fetch.
    if (selectedLead && !isRozee) {
      const leadId = selectedLead._id || selectedLead.id;
      fetchPosts(leadId);
    }
  }, [selectedLead, isRozee, fetchPosts]);


  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4 bg-base-100">
        <button
          onClick={onToggleCollapse}
          className="btn btn-ghost btn-sm btn-circle mb-4"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="writing-mode-vertical text-sm text-base-content/60">
          {isRozee ? (isRozeeJob ? "Job" : "Profile") : "Posts"}
        </div>
      </div>
    );
  }

  const headerTitle = isRozee
    ? isRozeeJob
      ? "Job enrichment"
      : "Candidate Profile"
    : "Recent Posts";

  return (
    <div className="h-full flex flex-col bg-base-100">
      {/* Header */}
      <div className="p-3 border-b border-base-300">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-base-content">{headerTitle}</h2>
            {!isRozee && posts.length > 0 && (
              <div className="badge badge-primary badge-sm">{posts.length}</div>
            )}
            {isRozee && (
              <div className="badge badge-sm bg-emerald-600 text-white border-none">
                Rozee.pk
              </div>
            )}
          </div>
          <button
            onClick={onToggleCollapse}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {selectedLead && (
          <div className="text-sm text-base-content/60 mb-2">
            {selectedLead.name || "Selected Lead"}
          </div>
        )}

        {!isRozee && lastFetched && (
          <div className="text-xs text-base-content/40">
            Last updated: {formatTimestamp(lastFetched)}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {!selectedLead ? (
          <div className="p-4 text-center text-base-content/60">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              Select a lead to view{" "}
              {isRozee ? (isRozeeJob ? "job enrichment" : "profile") : "posts"}
            </p>
          </div>
        ) : isRozee && isRozeeJob ? (
          <RozeeJobLeadCard lead={selectedLead} />
        ) : isRozee ? (
          <RozeeCandidateCard lead={selectedLead} />
        ) : isLoading ? (
          <div className="p-4 text-center text-base-content/60">
            <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Fetching posts...</p>
          </div>
        ) : posts.length === 0 && selectedLead.status !== "completed" ? (
          <div className="p-4 text-center text-base-content/60">
            <Loader2 className="h-8 w-8 mx-auto mb-2 opacity-50 animate-spin" />
            <p className="text-sm">Processing lead...</p>
            <p className="text-xs">Posts will appear once processing is complete</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="p-4 text-center text-base-content/60">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No posts found</p>
            <p className="text-xs">This lead may not have recent public posts</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {posts.map((post) => (
              <div
                key={post.id}
                className="card bg-base-100 border border-base-300 hover:shadow-sm transition-shadow"
              >
                <div className="card-body p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs text-base-content/60">
                      <Calendar className="h-3 w-3" />
                      {formatTimestamp(post.timestamp)}
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="badge badge-outline badge-sm gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {formatNumber(calculateEngagement(post.likes, post.comments, post.reposts))}
                      </div>
                      <button
                        className="btn btn-ghost btn-xs btn-circle"
                        onClick={() => window.open(post.url, "_blank")}
                        title="View on LinkedIn"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-base-content leading-relaxed mb-4">
                    {post.content}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-base-content/60">
                    <div className="flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {formatNumber(post.likes)}
                    </div>
                    <div className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {formatNumber(post.comments)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Repeat2 className="h-3 w-3" />
                      {formatNumber(post.reposts)}
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <Eye className="h-3 w-3" />
                      <span>High engagement</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default PostsColumn;
