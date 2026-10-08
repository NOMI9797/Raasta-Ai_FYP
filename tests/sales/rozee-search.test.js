// Rozee.pk job posts read from search-engine results. The fixture holds real results captured
// from a live search on 7 Oct 2026 (site:rozee.pk "react developer" lahore, and Flutter).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { buildRozeeQueries, companyFromSlug, inLocation, jobPostUrl, parseRozeeResult, searchRozeeJobPosts, slugify } from "../../libs/sales/rozee-search";

const RESULTS = JSON.parse(readFileSync(new URL("../fixtures/sales/rozee-search-results.json", import.meta.url), "utf8"));
const byId = (id) => RESULTS.map(parseRozeeResult).find((p) => p?.jobId === id);

test("only real job post URLs count: not search pages, company pages, portals or the home page", () => {
  assert.deepEqual(jobPostUrl("https://www.rozee.pk/dextrologix-pvt-ltd-react-developer-lahore-jobs-1404759"), {
    url: "https://www.rozee.pk/dextrologix-pvt-ltd-react-developer-lahore-jobs-1404759", slug: "dextrologix-pvt-ltd-react-developer-lahore", jobId: "1404759",
  });
  assert.equal(jobPostUrl("https://rozee.pk/x-jobs-12?utm=1").jobId, "12");
  for (const bad of [
    "https://www.rozee.pk/job/jsearch/q/Flutter%20Developer",
    "https://www.rozee.pk/company/naseeb-enterprise-inc/jobs/?fpn=20",
    "https://minhaj.rozee.pk/job-details.php?jid=1609640",
    "https://www.rozee.pk/",
    "https://evil.example/rozee.pk/x-jobs-1",
    "not a url",
  ]) assert.equal(jobPostUrl(bad), null, bad);
});

test("title, cities and company are read from a full title", () => {
  assert.deepEqual(byId("1404759"), {
    jobId: "1404759", url: "https://www.rozee.pk/dextrologix-pvt-ltd-react-developer-lahore-jobs-1404759",
    title: "React Developer", company: "Dextrologix (Pvt.) Ltd", cities: ["Lahore"], location: "Lahore",
  });
  assert.equal(byId("1514164").title, "React Developer - Intern");
  assert.equal(byId("1514164").company, "Terasols");
  assert.equal(byId("1564342").company, "Resolute Digitals");
});

test("a cut-off title takes the company from the URL", () => {
  const p = byId("1368362"); // "Senior React.js Developer Job, Islamabad, Faisalabad, Lahore, Multan ..."
  assert.equal(p.company, "Systems Ltd");
  assert.deepEqual(p.cities, ["Islamabad", "Faisalabad", "Lahore", "Multan"]);
  assert.equal(byId("1451471").company, "Alphabet Global");
  // Punctuation dropped in the URL ("React.js" → "reactjs") still lines up
  assert.equal(companyFromSlug("systems-ltd-senior-reactjs-developer-lahore", "Senior React.js Developer"), "Systems Ltd");
  assert.equal(companyFromSlug("flutter-developer-islamabad", "Flutter Developer"), null, "no words before the title: no company");
});

test("a post with no company stays without one (it can't become a lead)", () => {
  assert.equal(byId("1645480").company, null);
  assert.equal(byId("1660148").company, "Tecaudex");
});

test("pages that aren't job posts are dropped", () => {
  const parsed = RESULTS.map(parseRozeeResult).filter(Boolean);
  assert.equal(parsed.length, 8);
});

test("queries and the city filter", () => {
  assert.deepEqual(buildRozeeQueries({ query: "react developer", location: "Lahore" }), [
    'site:rozee.pk "react developer" Lahore job',
    "site:rozee.pk react developer Lahore jobs",
  ]);
  assert.deepEqual(buildRozeeQueries({ query: "", location: "Karachi" }), ["site:rozee.pk Karachi job", "site:rozee.pk Karachi jobs"]);
  assert.equal(inLocation({ cities: ["Islamabad", "Lahore"] }, "lahore"), true);
  assert.equal(inLocation({ cities: ["Karachi"] }, "Lahore"), false);
  assert.equal(inLocation({ cities: [] }, "Lahore"), true);
  assert.equal(slugify("Senior React.js Developer"), "senior-react-js-developer");
});

test("search: deduplicated across queries, filtered by city, limited, in the import shape", async () => {
  const calls = [];
  const search = async (q) => {
    calls.push(q);
    return RESULTS;
  };
  const posts = await searchRozeeJobPosts({ query: "react developer", location: "Lahore", limit: 5 }, { search });
  assert.equal(posts.length, 5);
  assert.equal(new Set(posts.map((p) => p.url)).size, 5);
  assert.ok(posts.every((p) => p.source === "rozee" && p.sourceData.cities.includes("Lahore")), "Karachi/Islamabad-only posts dropped");
  assert.deepEqual(Object.keys(posts[0]).sort(), ["company", "location", "name", "salary", "source", "sourceData", "title", "url"]);
  assert.equal(posts[0].sourceData.company.name, posts[0].company);
  assert.equal(calls.length, 1, "the second query isn't needed once the limit is reached");
  await assert.rejects(searchRozeeJobPosts({ query: " ", location: "" }, { search }), /job title or a location/);
});

// ─── Google (Serper) results: mostly search-listing pages, captured live on 9 Oct 2026 ───
const GOOGLE = JSON.parse(readFileSync(new URL("../fixtures/sales/rozee-serper-results.json", import.meta.url), "utf8"));
import { embeddedPost, isRelevant, looksLikeCompany, looksLikeRole, parseListingSnippet, searchTerms, splitSlug } from "../../libs/sales/rozee-search";

test("a job post inside a listing-page URL is found", () => {
  assert.deepEqual(embeddedPost("https://www.rozee.pk/job/jsearch/q/technerds-inc-react-native-developer-lahore-jobs-1217544/"), {
    url: "https://www.rozee.pk/technerds-inc-react-native-developer-lahore-jobs-1217544", slug: "technerds-inc-react-native-developer-lahore", jobId: "1217544",
  });
  assert.equal(embeddedPost("https://www.rozee.pk/job/jsearch/q/React%20Js"), null);
});

test("company, role and city from a slug, using the words searched for", () => {
  assert.deepEqual(splitSlug("technerds-inc-react-native-developer-lahore", "react developer"), { company: "Technerds Inc", title: "React Native Developer", cities: ["Lahore"], relevant: true });
  assert.deepEqual(splitSlug("react-developer-karachi", "react developer"), { company: null, title: "React Developer", cities: ["Karachi"], relevant: true }, "role first: no company");
  // Found live: "developer" alone must not decide the split, or the role becomes just "Developer"
  assert.equal(splitSlug("innovative-software-solution-angularjs-developer-lahore", "flutter developer").relevant, false, "not a Flutter job");
  assert.deepEqual(splitSlug("4xp-tech-pvt-ltd-flutter-developer-lahore", "flutter developer"), { company: "4xp Tech Pvt Ltd", title: "Flutter Developer", cities: ["Lahore"], relevant: true });
});

test("listing snippets name jobs and companies; noise is dropped", () => {
  assert.deepEqual(parseListingSnippet("Junior React JS Developer. Miletap Pvt Ltd ; MERN Full Stack Developer. Walee Financial Services ; React JS Developer. MTBC CareCloud ; Seni"), [
    { title: "Junior React JS Developer", company: "Miletap Pvt Ltd", city: null },
    { title: "MERN Full Stack Developer", company: "Walee Financial Services", city: null },
    { title: "React JS Developer", company: "MTBC CareCloud", city: null },
  ]);
  assert.deepEqual(parseListingSnippet("We're Hiring: Mobile App Developer. Computer House Lahore, Pakistan"), [{ title: "Mobile App Developer", company: "Computer House", city: "Lahore" }]);
  assert.deepEqual(parseListingSnippet("... developer-lahore-jobs-1217544. Edit | Save as Alert. React Native Developer. SoftLink"), []);
});

test("company and role checks", () => {
  for (const ok of ["MTBC CareCloud", "Miletap Pvt Ltd", "The TAQ Organization", "Dextrologix (Pvt.) Ltd"]) assert.ok(looksLikeCompany(ok), ok);
  for (const bad of ["Architect (React / Node /", "Java Developer (Spring Boot)5 years Experience", "Lahore", "Senior Engineer", "Oct 02, 2026", "Edit | Save as Alert"]) assert.ok(!looksLikeCompany(bad), bad);
  assert.ok(looksLikeRole("React JS Developer"));
  assert.ok(!looksLikeRole("175K Front-End Developer"));
  assert.ok(!looksLikeRole("React Js jobs in Pakistan"));
});

test("real Google results: job posts first, then one lead per company named in snippets", async () => {
  const leads = await searchRozeeJobPosts({ query: "react developer", location: "Lahore", limit: 25 }, { search: async () => GOOGLE, maxCalls: 1 });
  assert.deepEqual(leads.map((l) => [l.company, l.sourceData.rozeeFoundOn]), [
    ["Foxtek Systems", "post"],
    ["Technerds Inc", "post"],
    ["Computer House", "listing"],
    ["Miletap Pvt Ltd", "listing"],
    ["MTBC CareCloud", "listing"],
  ]);
  // Dropped as off-topic for "react developer": Nessovo (Java), Walee (MERN, no "React" in the title)
  assert.equal(new Set(leads.map((l) => l.url)).size, leads.length, "every lead has its own link");
  assert.ok(leads.filter((l) => l.sourceData.rozeeFoundOn === "post").every((l) => /-jobs-\d+$/.test(l.url)));
});

test("searching stops at the page budget and asks for 10 results at a time", async () => {
  const calls = [];
  await searchRozeeJobPosts({ query: "qa engineer", location: "Karachi", limit: 50 }, { search: async (q, opts) => (calls.push({ q, ...opts }), []), maxCalls: 4 });
  assert.equal(calls.length, 2, "an empty page 1 skips its page 2; two queries tried");
  assert.ok(calls.every((c) => c.num === 10));
});

test("relevance: the specific word searched for decides, generic words don't", () => {
  assert.deepEqual([...searchTerms("Flutter Developer")], ["flutter"]);
  assert.deepEqual([...searchTerms("senior developer")], ["senior", "developer"], "only generic words: use them all");
  assert.ok(isRelevant("Android Developer with Flutter Experience", "flutter developer"));
  assert.ok(!isRelevant("E-commerce Data Entry Executive", "flutter developer"));
  assert.ok(!isRelevant("Business Development Manager", "flutter developer"));
});
