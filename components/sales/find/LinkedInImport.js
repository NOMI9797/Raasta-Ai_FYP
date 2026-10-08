"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { FileUp, Info, Loader2, Plus } from "lucide-react";
import { readLinkedInLeadsCsv } from "@/libs/sales/csv";

// Add LinkedIn people to the campaign: paste profile URLs, or upload a CSV
// (a LinkedIn / Sales Navigator export or your own sheet with a URL column).
export default function LinkedInImport({ campaignId, onImported }) {
  const [text, setText] = useState("");
  const [csvRows, setCsvRows] = useState(null); // { fileName, rows, skipped }
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);

  const pastedUrls = text
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => /linkedin\.com\//i.test(u));

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, skipped } = readLinkedInLeadsCsv(String(reader.result || ""));
      if (!rows.length) {
        toast.error("No LinkedIn profile URLs found in that file");
        setCsvRows(null);
        return;
      }
      setCsvRows({ fileName: file.name, rows, skipped });
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    if (!pastedUrls.length && !csvRows?.rows.length) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/campaigns/${campaignId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: pastedUrls, csvData: csvRows?.rows || [] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || data.error || "Could not add leads");
      toast.success(data.message);
      setText("");
      setCsvRows(null);
      onImported?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const total = pastedUrls.length + (csvRows?.rows.length || 0);

  return (
    <div className="card bg-base-200 border border-base-300 p-4 space-y-4">
      <p className="text-sm text-base-content/70 flex gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        LinkedIn leads are people. Add their profile URLs; in the Research step we read their profile and recent posts.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-xs mb-1">Paste profile URLs (one per line)</span>
          <textarea
            className="textarea textarea-bordered h-32 text-sm font-mono"
            placeholder={"https://www.linkedin.com/in/someone\nhttps://www.linkedin.com/in/someone-else"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text && <span className="text-xs text-base-content/60 mt-1">{pastedUrls.length} LinkedIn URL{pastedUrls.length === 1 ? "" : "s"} found</span>}
        </label>

        <div className="flex flex-col">
          <span className="label-text text-xs mb-1">Or upload a CSV</span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex-1 min-h-32 rounded-lg border-2 border-dashed border-base-300 hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-sm text-base-content/70 p-4"
          >
            <FileUp className="h-6 w-6" />
            {csvRows ? (
              <>
                <span className="font-medium text-base-content">{csvRows.fileName}</span>
                <span className="text-xs">
                  {csvRows.rows.length} profile{csvRows.rows.length === 1 ? "" : "s"}
                  {csvRows.skipped ? `, ${csvRows.skipped} row${csvRows.skipped === 1 ? "" : "s"} without a LinkedIn URL skipped` : ""}
                </span>
              </>
            ) : (
              <>
                <span>Choose a .csv file</span>
                <span className="text-xs">Columns: LinkedIn URL (required), name, title, company</span>
              </>
            )}
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </div>
      </div>

      {csvRows && (
        <div className="overflow-x-auto max-h-56 rounded-lg border border-base-300 bg-base-100">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Company</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {csvRows.rows.slice(0, 50).map((r) => (
                <tr key={r.url}>
                  <td>{r.name || "—"}</td>
                  <td>{r.title || "—"}</td>
                  <td>{r.company || "—"}</td>
                  <td className="truncate max-w-[16rem] text-base-content/60">{r.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {csvRows.rows.length > 50 && <p className="text-xs text-base-content/60 p-2">…and {csvRows.rows.length - 50} more</p>}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {csvRows && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCsvRows(null)}>
            Clear file
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm gap-2" disabled={!total || saving} onClick={submit}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add {total || ""} to campaign
        </button>
      </div>
    </div>
  );
}
