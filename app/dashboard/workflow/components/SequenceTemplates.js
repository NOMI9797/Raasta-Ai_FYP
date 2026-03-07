"use client";

import { useRouter } from "next/navigation";
import LeadGenerationPreview from "../templates/lead-generation/Preview";
import EndorseSkillsPreview from "../templates/send-invite/Preview";
import ExtraProfileViewsPreview from "../templates/extra-profile-views/Preview";

const templates = [
  {
    id: "lead-generation",
    title: "Lead Generation",
    description: "Multi-step outreach with follow-ups",
  },
  {
    id: "endorse-my-skills",
    title: "Send Invite",
    description: "Simple workflow to send a connection invite",
  },
  {
    id: "extra-profile-views",
    title: "Extra Profile Views",
    description: "Actions to boost visibility and views",
  },
];

export default function SequenceTemplates() {
  const router = useRouter();

  const handleSelectTemplate = (id) => {
    const params = new URLSearchParams();
    params.set('template', id);
    router.push(`/dashboard/workflow?${params.toString()}`);
  };

  const handleCustom = () => {
    const params = new URLSearchParams();
    params.set('template', 'custom');
    router.push(`/dashboard/workflow?${params.toString()}`);
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-2xl font-semibold">Sequence templates</h3>
            <p className="text-sm text-base-content/60 mt-1">Choose a pre-built template or start with a custom campaign.</p>
          </div>
          <button className="btn btn-primary" onClick={handleCustom}>Custom campaign</button>
        </div>

        <div className="tabs tabs-boxed w-fit mb-6">
          <a className="tab tab-active">Pre-built Templates</a>
          <a className="tab">Saved Templates</a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {templates.map((t) => (
            <div key={t.id} className="card bg-base-100 border border-base-300 shadow-sm hover:shadow-md transition-shadow">
              <div className="card-body">
                <div className="aspect-[16/9] w-full rounded-lg bg-base-200/60 border border-base-300 overflow-hidden">
                  {t.id === "lead-generation" ? (
                    <LeadGenerationPreview />
                  ) : t.id === "endorse-my-skills" ? (
                    <EndorseSkillsPreview />
                  ) : t.id === "extra-profile-views" ? (
                    <ExtraProfileViewsPreview />
                  ) : (
                    <div className="flex items-center justify-center text-xs text-base-content/60 h-full">
                      Template preview
                    </div>
                  )}
                </div>
                <div className="mt-4">
                  <div className="text-lg font-semibold">{t.title}</div>
                  <div className="text-xs text-base-content/60 mt-1">{t.description}</div>
                </div>
                <div className="mt-4">
                  <button className="btn btn-sm btn-outline" onClick={() => handleSelectTemplate(t.id)}>Select template</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}