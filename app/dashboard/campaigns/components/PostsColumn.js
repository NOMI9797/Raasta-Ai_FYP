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
          {isRozee ? "Profile" : "Posts"}
        </div>
      </div>
    );
  }

  const headerTitle = isRozee ? "Candidate Profile" : "Recent Posts";

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
              Select a lead to view {isRozee ? "profile" : "posts"}
            </p>
          </div>
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
