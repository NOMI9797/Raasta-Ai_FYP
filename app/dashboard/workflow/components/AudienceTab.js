"use client";

export default function AudienceTab() {
  return (
    <div className="h-full p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Audience</h3>
          <p className="text-sm text-base-content/60">Define who enters this sequence.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <div className="font-medium">Filters</div>
              <div className="text-xs text-base-content/60">Coming soon: roles, regions, tags, activity.</div>
            </div>
          </div>
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <div className="font-medium">Sources</div>
              <div className="text-xs text-base-content/60">Import CSV, Sales Navigator, lists.</div>
            </div>
          </div>
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <div className="font-medium">Preview</div>
              <div className="text-xs text-base-content/60">Lead count and sample entries.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
