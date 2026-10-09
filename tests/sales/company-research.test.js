import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEmails, dropPartialNumbers, emailsOnDomain, extractContacts, nameParts, originOf, parseLinkedInResult, pickWebsite, pickWebsiteDetail } from "../../libs/sales/company-research";
import WEBSITE_RESULTS from "../fixtures/sales/website-search-results.json";

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

// Real Serper results captured on 9 Oct 2026 for "<company> Lahore official website", when the
// end-to-end agent run picked the wrong website for several Lahore companies.
test("the website must carry the company's name: no more 'first result' guesses (found by the end-to-end run)", () => {
  // Before: asifcomputers.com (a laptop shop) for "Computer House", a Lahore software house
  assert.equal(pickWebsiteDetail(WEBSITE_RESULTS["Computer House"], "Computer House", { city: "Lahore" }), null);
  // Before: alphabet.com (BMW's leasing firm). Now a full-name domain, but nothing ties it to Pakistan
  const alphabet = pickWebsiteDetail(WEBSITE_RESULTS["Alphabet Global"], "Alphabet Global", { city: "Lahore" });
  assert.notEqual(alphabet.url, "https://www.alphabet.com");
  assert.notEqual(alphabet.url, "https://alphabetglobal.in", "an exact name on another country's domain is another company");
  assert.deepEqual([alphabet.match, alphabet.local], ["full", false]);
  // prima.systems: the whole name across the dot, and its contact page names Lahore
  assert.deepEqual(pickWebsiteDetail(WEBSITE_RESULTS["Prima Systems"], "Prima Systems", { city: "Lahore" }), { url: "https://prima.systems", match: "exact", local: true });
});

test("a first-word match is only taken with a sign the site is in Pakistan; registries and job sites never", () => {
  const results = [{ link: "https://www.alphabet.com/en-ww/career.html", title: "Careers", snippet: "business mobility" }];
  assert.equal(pickWebsite(results, "Alphabet Global", { city: "Lahore" }), null);
  assert.equal(pickWebsite([{ link: "https://alphabet.pk/", title: "Alphabet", snippet: "" }], "Alphabet Global", { city: "Lahore" }), "https://alphabet.pk");
  assert.equal(pickWebsite([{ link: "https://find-and-update.company-information.service.gov.uk/company/1" }, { link: "https://bebee.com/x" }], "InventorX Technologies"), null);
  assert.deepEqual(nameParts("Dextrologix (Pvt.) Ltd"), { full: "dextrologix", words: ["dextrologix"], distinct: ["dextrologix"] });
  // A name made only of common words still matches a domain holding all of them, in any order
  assert.deepEqual(pickWebsiteDetail([{ link: "https://irsolutions.tech/", title: "IR Solutions", snippet: "" }], "IR-Tech Solutions"), { url: "https://irsolutions.tech", match: "words", local: false });
  assert.equal(pickWebsiteDetail([{ link: "https://rfzdigital.com/", title: "RFZ", snippet: "" }], "RFZ Digital").match, "exact");
});

test("emails: placeholders, stray characters and other companies' domains are dropped", () => {
  assert.deepEqual(cleanEmails(["getincontact@alphabet.com", "bewerber.hotline@bmw.de"], "https://www.alphabet.com"), ["getincontact@alphabet.com"]);
  assert.deepEqual(cleanEmails(["youremail@mail.com", "neuros@mail.co"], "https://technodevs.com"), []);
  assert.deepEqual(cleanEmails(["support@bebee.com\\"], "https://bebee.com"), ["support@bebee.com"]);
  // Related domains and free mailboxes stay
  assert.deepEqual(cleanEmails(["info@4xportal.com"], "https://4xptech.com"), ["info@4xportal.com"]);
  assert.deepEqual(cleanEmails(["contact.nexsoll@gmail.com", "info@rfz.digital"], "https://rfzdigital.com"), ["contact.nexsoll@gmail.com", "info@rfz.digital"]);
  assert.deepEqual(cleanEmails(["info@primasystems.net"], "https://prima.systems"), ["info@primasystems.net"]);
});

test("emails on the company's domain are read from web results, and only that domain (wider email search)", () => {
  const results = [
    { title: "Nexsoll - Contact", snippet: "Write to hr@nexsoll.com. Our sister firm: info@nexsoll.com.pk" },
    { title: "Jobs", snippet: "Send CVs to careers@mail.nexsoll.com or someone@othernexsoll.com, ali@gmail.com" },
  ];
  assert.deepEqual(emailsOnDomain(results, "www.nexsoll.com"), ["hr@nexsoll.com", "careers@mail.nexsoll.com"]);
  assert.deepEqual(emailsOnDomain(results, ""), []);
});

test("website titles are decoded, numeric entities too (Research page showed 'Dextrologix &#8211; …')", () => {
  const { title } = extractContacts("<title>Dextrologix &#8211; Trusted to Deliver Excellence &amp; More&#x21;</title>", "https://dextrologix.com");
  assert.equal(title, "Dextrologix – Trusted to Deliver Excellence & More!");
});

test("leftover page code is cut off an address (Approvals showed 'x@gmail.comquot')", () => {
  assert.deepEqual(cleanEmails(["institut.deutsch@gmail.com&quot;", "hr@acme.pk?subject=Hi", "info@acme.pk;sales@acme.pk"], "https://acme.pk"), ["institut.deutsch@gmail.com", "hr@acme.pk", "info@acme.pk"]);
  assert.deepEqual(cleanEmails(["someone@gmail.comquot"], "https://acme.pk"), [], "already glued together: dropped");
});
