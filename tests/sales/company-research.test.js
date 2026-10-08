import { test } from "node:test";
import assert from "node:assert/strict";
import { dropPartialNumbers, extractContacts, originOf, parseLinkedInResult, pickWebsite } from "../../libs/sales/company-research";

test("dropPartialNumbers keeps the full number when the same one was also read cut short", () => {
  assert.deepEqual(dropPartialNumbers(["03132318300", "+922134835018", "+92213483501"]), ["03132318300", "+922134835018"]);
});

test("pickWebsite skips listing sites and prefers a domain with the company's name", () => {
  const results = [
    { link: "https://www.linkedin.com/company/cubix" },
    { link: "https://pk.worldorgs.com/catalog/karachi/cubix" },
    { link: "https://somenews.pk/article" },
    { link: "https://www.cubix.co/about/" },
  ];
  assert.equal(pickWebsite(results, "Cubix Inc"), "https://www.cubix.co");
  assert.equal(pickWebsite([{ link: "https://indeed.com/x" }], "Cubix"), null);
});

test("originOf keeps only the site root and accepts bare domains", () => {
  assert.equal(originOf("https://www.capgemini.com/es-es/sobre-nosotros/"), "https://www.capgemini.com");
  assert.equal(originOf("absinternational.pk"), "https://absinternational.pk");
  assert.equal(originOf(null), null);
});

test("extractContacts finds emails (including Cloudflare-hidden ones), phones, socials and contact pages", () => {
  // "info@acme.pk" XOR-encoded with key 0x42, the way Cloudflare hides it
  const cf = "42" + [..."info@acme.pk"].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, "0")).join("");
  const html = `
    <title>Acme | Software</title>
    <meta name="description" content="We build apps.">
    <a href="mailto:Sales@Acme.pk">mail</a> <span data-cfemail="${cf}"></span>
    <img src="logo@2x.png"> hr@acme.pk
    <a href="tel:+92-42-111-222-333">call</a> UAN: 111-222-444
    <a href="https://www.linkedin.com/company/acme/?trk=x">in</a>
    <a href="https://www.facebook.com/sharer/sharer.php">share</a>
    <a href="/contact-us">Contact</a> <a href="https://other.com/contact">x</a>`;
  const out = extractContacts(html, "https://acme.pk/");
  assert.deepEqual(out.emails.sort(), ["hr@acme.pk", "info@acme.pk", "sales@acme.pk"]);
  assert.ok(out.phones.includes("+9242111222333"));
  assert.ok(out.phones.includes("111222444"));
  assert.equal(out.socials.linkedin, "https://www.linkedin.com/company/acme/");
  assert.equal(out.socials.facebook, undefined);
  assert.deepEqual(out.links, ["https://acme.pk/contact-us"]);
  assert.equal(out.title, "Acme | Software");
  assert.equal(out.description, "We build apps.");
});

test("parseLinkedInResult reads name and title and ranks leadership first", () => {
  const ceo = parseLinkedInResult({ title: "Ali Khan - CEO - Cubix | LinkedIn", link: "https://pk.linkedin.com/in/alikhan?x=1", snippet: "" }, "Cubix Inc");
  assert.deepEqual(ceo, { name: "Ali Khan", title: "CEO · Cubix", linkedinUrl: "https://pk.linkedin.com/in/alikhan", role: "leadership" });
  const hr = parseLinkedInResult({ title: "Sara Ahmed – HR Manager – Cubix | LinkedIn", link: "https://linkedin.com/in/sara", snippet: "" }, "Cubix");
  assert.equal(hr.role, "hiring");
});

test("parseLinkedInResult ignores other companies and non-profile links", () => {
  assert.equal(parseLinkedInResult({ title: "Bob - CEO - Other Co | LinkedIn", link: "https://linkedin.com/in/bob", snippet: "" }, "Cubix"), null);
  assert.equal(parseLinkedInResult({ title: "Cubix | LinkedIn", link: "https://linkedin.com/company/cubix", snippet: "" }, "Cubix"), null);
});
