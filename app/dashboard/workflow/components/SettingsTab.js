"use client";

export default function SettingsTab() {
  return (
    <div className="h-full p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Campaign Settings</h3>
          <p className="text-sm text-base-content/60">Configure limits, windows, and defaults (UI only).</p>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label"><span className="label-text">Timezone</span></label>
              <select className="select select-bordered w-full">
                <option>Browser default</option>
                <option>UTC</option>
              </select>
            </div>
            <div>
              <label className="label"><span className="label-text">Working hours</span></label>
              <input className="input input-bordered w-full" placeholder="9:00 - 17:00" />
            </div>
            <div>
              <label className="label"><span className="label-text">Daily connect cap</span></label>
              <input type="number" className="input input-bordered w-full" placeholder="20" />
            </div>
            <div>
              <label className="label"><span className="label-text">Daily message cap</span></label>
              <input type="number" className="input input-bordered w-full" placeholder="50" />
            </div>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <div className="font-medium mb-2">Template defaults</div>
            <textarea className="textarea textarea-bordered w-full h-32" placeholder="Default message template..." />
          </div>
        </div>
      </div>
    </div>
  );
}
