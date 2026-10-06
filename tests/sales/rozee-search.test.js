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
