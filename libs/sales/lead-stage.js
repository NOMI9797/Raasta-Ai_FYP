// Where a lead is in the pipeline, as one short label with its colour (Find leads table).
// Pure and browser-safe; unit-tested.

export function leadStage(lead, isCompany) {
  if (isCompany && !(lead.company || lead.sourceData?.company?.name)) return { label: "No company", tone: "bg-slate-100 text-slate-500" };
  const s = lead.conversationStatus;
  if (s === "meeting_booked") return { label: "Meeting booked", tone: "bg-emerald-100 text-emerald-700" };
  if (["replied", "in_conversation", "meeting_proposed"].includes(s)) return { label: "Replied", tone: "bg-sky-100 text-sky-700" };
  if (["not_interested", "unsubscribed", "no_response"].includes(s)) return { label: "Closed", tone: "bg-slate-100 text-slate-600" };
  if (lead.messageSent) return { label: "Contacted", tone: "bg-indigo-100 text-indigo-700" };
  const fit = lead.sourceData?.fit?.score;
  if (Number.isFinite(fit)) return { label: `Fit ${fit}`, tone: fit >= 70 ? "bg-emerald-50 text-emerald-700" : fit >= 50 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700" };
  if (isCompany ? lead.sourceData?.research : lead.status === "completed") return { label: isCompany ? "Researched" : "Profile read", tone: "bg-violet-50 text-violet-700" };
  if (!isCompany && lead.status === "error") return { label: "Read failed", tone: "bg-rose-50 text-rose-700" };
  return { label: "New", tone: "bg-slate-100 text-slate-600" };
}
