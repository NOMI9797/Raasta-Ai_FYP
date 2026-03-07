"use client";

export default function StatisticsTab() {
  return (
    <div className="h-full p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Statistics</h3>
          <p className="text-sm text-base-content/60">Funnel and performance metrics (UI only).</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {["Queued", "Sent", "Accepted", "Replied"].map((label) => (
            <div key={label} className="card bg-base-100 border border-base-300">
              <div className="card-body">
                <div className="text-xs text-base-content/60">{label}</div>
                <div className="text-2xl font-bold">0</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card bg-base-100 border border-base-300 h-64">
            <div className="card-body">
              <div className="font-medium">Step conversion</div>
              <div className="text-xs text-base-content/60">Chart placeholder</div>
            </div>
          </div>
          <div className="card bg-base-100 border border-base-300 h-64">
            <div className="card-body">
              <div className="font-medium">Time to advance</div>
              <div className="text-xs text-base-content/60">Chart placeholder</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
