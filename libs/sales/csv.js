// Reads a LinkedIn leads CSV (a Sales Navigator / LinkedIn export, or a sheet you made yourself)
// into rows the add-leads API understands: { url, name, title, company }.

/** Split CSV text into rows of cells. Handles quoted cells with commas, quotes and line breaks. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const normalise = (h) => h.toLowerCase().replace(/[^a-z]/g, "");

// Header names seen in LinkedIn / Sales Navigator exports and hand-made sheets
const COLUMN_ALIASES = {
  url: ["url", "linkedinurl", "profileurl", "linkedinprofileurl", "linkedin", "profile", "personlinkedinurl", "publicprofileurl"],
  name: ["name", "fullname", "contactname"],
  firstName: ["firstname"],
  lastName: ["lastname"],
  title: ["title", "jobtitle", "position", "headline", "currenttitle"],
  company: ["company", "companyname", "organization", "currentcompany", "account"],
};

const isLinkedInUrl = (value) => /linkedin\.com\/(in|pub|sales\/lead|sales\/people)\//i.test(value || "");

/**
 * @returns {{ rows: {url,name,title,company}[], skipped: number }}
 * Finds the columns from a header row when there is one; otherwise takes the first LinkedIn URL in each line.
 */
export function readLinkedInLeadsCsv(text) {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], skipped: 0 };

  const header = table[0].map(normalise);
  const find = (key) => header.findIndex((h) => COLUMN_ALIASES[key].includes(h));
  const columns = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((key) => [key, find(key)]));
  const hasHeader = columns.url >= 0 && !isLinkedInUrl(table[0][columns.url]);
  const body = hasHeader ? table.slice(1) : table;

  const rows = [];
  let skipped = 0;
  for (const cells of body) {
    const url = hasHeader ? cells[columns.url] : cells.find(isLinkedInUrl);
    if (!isLinkedInUrl(url)) {
      skipped++;
      continue;
    }
    const pick = (key) => (hasHeader && columns[key] >= 0 ? cells[columns[key]] || "" : "");
    const fullName = pick("name") || [pick("firstName"), pick("lastName")].filter(Boolean).join(" ");
    rows.push({
      url: url.trim(),
      name: fullName || undefined,
      title: pick("title") || undefined,
      company: pick("company") || undefined,
    });
  }
  return { rows, skipped };
}
