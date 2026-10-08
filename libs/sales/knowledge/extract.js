// Text for the knowledge base from an uploaded file or a web page. Relative imports only.
import { extractResumeText, resumeExtension } from "../../hiring/resume-text";
import { normaliseText } from "./chunk";

export const KB_FILE_TYPES = [".pdf", ".docx", ".txt", ".md"];
export const MAX_KB_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_KB_TEXT = 200_000; // characters per document
const PAGE_TIMEOUT_MS = 10_000;

export function validateKbFile({ filename, size }) {
  if (!KB_FILE_TYPES.includes(resumeExtension(filename))) return "Upload a PDF, DOCX, TXT or Markdown file";
  if (!size) return "The file is empty";
  if (size > MAX_KB_FILE_BYTES) return "Files must be 10 MB or smaller";
  return null;
}

export async function extractFileText({ buffer, filename }) {
  const { text } = await extractResumeText({ buffer, filename });
  return normaliseText(text).slice(0, MAX_KB_TEXT);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "—", ndash: "–", hellip: "…" };

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Readable text of an HTML page: no scripts, menus or footers; headings and list items on their own lines. */
export function htmlToText(html) {
  const body = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h[1-6][^>]*>/gi, "\n\n## ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return normaliseText(
    decodeEntities(body)
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line, i, all) => line !== "-" && !(line === "" && all[i - 1] === ""))
      .join("\n")
      .replace(/^## \s*$/gm, "")
  );
}

/** Only public http(s) pages: the server must not be pointed at itself or the local network. */
export function checkPublicUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return { error: "Enter a full address, e.g. https://yourcompany.com/services" };
  }
  if (!["http:", "https:"].includes(url.protocol)) return { error: "Only http and https pages can be added" };
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.startsWith("[")
  ) {
    return { error: "That address isn't a public web page" };
  }
  return { url: url.toString() };
}

/** Title and text of one public web page. */
export async function fetchPageText(rawUrl, { fetchFn = fetch } = {}) {
  const { url, error } = checkPublicUrl(rawUrl);
  if (error) throw new Error(error);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RaastaAI-KnowledgeBase/1.0)", Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`The page answered ${res.status}`);
    if (!(res.headers.get("content-type") || "").includes("html")) throw new Error("That address isn't a web page");
    const html = (await res.text()).slice(0, 2_000_000);
    const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
    const text = htmlToText(html).slice(0, MAX_KB_TEXT);
    if (text.length < 50) throw new Error("Couldn't read any text on that page (it may need JavaScript)");
    return { url: res.url || url, title, text };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The page took too long to load");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
