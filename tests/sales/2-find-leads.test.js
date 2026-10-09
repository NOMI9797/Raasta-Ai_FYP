// Find leads (step 2): Rozee.pk search and import, company grouping, LinkedIn CSV import.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:find-leads   (or: npx tsx --test tests/sales/2-find-leads.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { db } from "../../libs/db";
import { sanitiseSalesConfig, startSalesRun } from "../../libs/sales/agent/launch";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { companyKey, findDuplicateCompanies, groupProfilesByCompany, jobsOf, leadCompanyKey, mergeJobs } from "../../libs/sales/companies";
import { parseCsv, readLinkedInLeadsCsv } from "../../libs/sales/csv";
import { buildRozeeQueries, companyFromSlug, embeddedPost, inLocation, isRelevant, jobPostUrl, looksLikeCompany, looksLikeRole, parseListingSnippet, parseRozeeResult, searchRozeeJobPosts, searchTerms, slugify, splitSlug } from "../../libs/sales/rozee-search";
import { agentActions, leads, messages } from "../../libs/schema";
import { closeDatabase, createCampaign, createRun, createUser, databaseReady, fakeEmail, removeUser, tickUntilIdle } from "./helpers/fixtures";

// ─── Rozee.pk search results (was rozee-search.test.js) ───
// Rozee.pk job posts read from search-engine results. The fixture holds real results captured
// from a live search on 7 Oct 2026 (site:rozee.pk "react developer" lahore, and Flutter).
describe("Rozee.pk search results", () => {
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
    // Found by the end-to-end agent run (9 Oct 2026): the role's first words went into the company name
    assert.deepEqual(splitSlug("jma-resources-javascript-developer-react-js-lahore", "React developer"), { company: "Jma Resources", title: "Javascript Developer React Js", cities: ["Lahore"], relevant: true });
    assert.deepEqual(splitSlug("technodevs-senior-reactjs-front-end-developer-lahore", "React developer"), { company: "Technodevs", title: "Senior Reactjs Front End Developer", cities: ["Lahore"], relevant: true });
    assert.equal(splitSlug("rozeepk-php-symfony-developer-react-js-lahore", "React developer").company, "Rozee.pk");
    assert.equal(splitSlug("systems-ltd-senior-reactjs-developer-lahore", "React developer").company, "Systems Ltd", "\"reactjs\" counts as React");
    assert.equal(splitSlug("abacus-consulting-technology-drupal-developer-lahore", "React developer").relevant, false);
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
});

// ─── Rozee.pk import (database) (was rozee.integration.test.js) ───
// Integration: a Rozee.pk campaign end to end against the real database. The agent searches
// Rozee.pk (search engine replaced by the real results in tests/fixtures), imports one lead per
// company, prepares and emails them. Email and the AI steps are fakes; nothing is sent.
describe("Rozee.pk import (database)", () => {
  const RESULTS = JSON.parse(readFileSync(new URL("../fixtures/sales/rozee-search-results.json", import.meta.url), "utf8"));
  let ready = false;
  let user;
  before(async () => {
    ready = await databaseReady();
    if (ready) user = await createUser();
  });
  after(async () => {
    if (user) await removeUser(user.id);
  });

  test("the agent finds companies on Rozee.pk, adds them and emails the good fits", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const campaign = await createCampaign(user.id, { name: "Rozee test", sources: ["rozee"] });
    const run = await createRun(user.id, campaign.id, { mode: "autopilot", config: { search: { platform: "rozee", query: "react developer", location: "Lahore", limit: 10 } } });
    const email = fakeEmail();
    const searched = [];
    const deps = {
      tick: async () => {},
      notifyFn: async () => {},
      emailFn: email.send,
      searchFn: async (filters) => {
        searched.push(filters);
        return { success: true, results: await searchRozeeJobPosts(filters, { search: async () => RESULTS }) };
      },
      researchFn: async (lead) => {
        const research = { status: "found", emails: [`hr@${lead.company.toLowerCase().replace(/[^a-z]/g, "")}.test`] };
        const [updated] = await db.update(leads).set({ sourceData: { ...lead.sourceData, research } }).where(eq(leads.id, lead.id)).returning();
        return updated;
      },
      scoreFn: async ({ lead }) => ({ score: lead.company === "Terasols" ? 20 : 75, reason: "test", model: "fake", scoredAt: new Date().toISOString() }),
      writeFn: async ({ lead, userId }) => {
        const [message] = await db.insert(messages).values({
          userId, leadId: lead.id, campaignId: lead.campaignId, source: "rozee", channel: "email", status: "draft", model: "fake",
          recipient: lead.sourceData.research.emails[0], subject: `About your ${lead.title} role`, content: "Hi,\n\nWe can help.\n\nTest",
        }).returning();
        return { message };
      },
    };

    await tickUntilIdle(advanceSalesRun, run.id, deps);

    assert.equal(searched[0].platform, "rozee", "the agent searched Rozee.pk, not Indeed");
    const rows = await db.select().from(leads).where(eq(leads.campaignId, campaign.id));
    assert.ok(rows.every((l) => l.source === "rozee"));
    // Lahore posts with a company: Dextrologix, Terasols, Systems Ltd, Alphabet Global, Veysel, Tecaudex
    const companies = rows.map((l) => l.company).filter(Boolean).sort();
    assert.deepEqual(companies, ["Alphabet Global", "Dextrologix (Pvt.) Ltd", "Systems Ltd", "Tecaudex", "Terasols", "Veysel Enterprises"]);

    const [find] = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.action, "find_leads")));
    assert.match(find.summary, /^Searched Rozee\.pk for "react developer in Lahore"/);

    assert.equal(email.sent.length, 5, "every good fit emailed; Terasols (fit 20) skipped");
    assert.ok(!email.sent.some((e) => e.to.includes("terasols")));
  });

  test("a Rozee.pk search needs a campaign that takes Rozee.pk leads", async (t) => {
    if (!ready) return t.skip("database not reachable");
    assert.equal(sanitiseSalesConfig({ campaignId: "x", search: { platform: "rozee", query: "qa" } }).search.platform, "rozee");
    assert.equal(sanitiseSalesConfig({ campaignId: "x", search: { platform: "monster", query: "qa" } }).search.platform, "indeed", "unknown boards fall back to Indeed");
    const indeedOnly = await createCampaign(user.id, { name: "Indeed only", sources: ["indeed"] });
    await assert.rejects(
      startSalesRun({ user, mode: "full_auto", config: { campaignId: indeedOnly.id, search: { platform: "rozee", query: "qa" } } }),
      /doesn't take Rozee\.pk leads/,
    );
  });
});

// ─── Companies: one lead per company, duplicates (was companies.test.js) ───
describe("Companies: one lead per company, duplicates", () => {
  test("companyKey ignores case, punctuation and legal suffixes", () => {
    assert.equal(companyKey("Cubix Inc."), "cubix");
    assert.equal(companyKey("CUBIX (Pvt) Ltd"), "cubix");
    assert.equal(companyKey("Datamatics Global Services Ltd"), "datamatics");
    assert.equal(companyKey("Ali & Sons Pvt. Ltd."), "ali and sons");
    assert.equal(companyKey(""), null);
    assert.equal(companyKey(null), null);
  });

  test("groups job posts of the same company and keeps nameless posts apart", () => {
    const groups = groupProfilesByCompany([
      { url: "a", company: "Datamatics Global Services Ltd", title: "Kafka Engineer" },
      { url: "b", company: "Datamatics Global Services", title: "QA" },
      { url: "c", company: "Cubix Inc", title: "SQA" },
      { url: "d", company: null, name: null, title: "Telecom Engineer" },
    ]);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0].profiles.map((p) => p.url), ["a", "b"]);
    assert.equal(groups[2].key, null);
  });

  test("mergeJobs skips job URLs that are already there", () => {
    const merged = mergeJobs([{ url: "a" }], [{ url: "a" }, { url: "b" }, { url: null }]);
    assert.deepEqual(merged.map((j) => j.url), ["a", "b"]);
  });

  test("jobsOf falls back to the lead's own job post", () => {
    assert.deepEqual(jobsOf({ url: "x", title: "Dev", source: "indeed", sourceData: { location: "Lahore" } }).map((j) => [j.url, j.title, j.location]), [["x", "Dev", "Lahore"]]);
    assert.equal(jobsOf({ url: "x", sourceData: { jobs: [{ url: "y" }, { url: "z" }] } }).length, 2);
  });

  test("findDuplicateCompanies keeps the oldest lead of each company", () => {
    const leads = [
      { id: 1, company: "DigitalOcean", createdAt: "2026-10-06T10:00:00Z", sourceData: {} },
      { id: 2, company: "DigitalOcean", createdAt: "2026-10-06T09:00:00Z", sourceData: {} },
      { id: 3, company: "Cubix", createdAt: "2026-10-06T09:00:00Z", sourceData: {} },
    ];
    const dupes = findDuplicateCompanies(leads);
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].keep.id, 2);
    assert.deepEqual(dupes[0].merge.map((l) => l.id), [1]);
  });

  test("the same company with or without a descriptor word is one company (found by the end-to-end agent run)", () => {
    // Rozee.pk named one company three ways on 9 Oct 2026, and the agent added it three times
    assert.equal(companyKey("Nessovo"), "nessovo");
    assert.equal(companyKey("Nessovo solutions"), "nessovo");
    assert.equal(companyKey("Nessovo Technologies"), "nessovo");
    // ...but a name is never cut to nothing or to a short, clashing word
    assert.equal(companyKey("Systems Ltd"), "systems");
    assert.equal(companyKey("IR-Tech Solutions"), "ir tech");
    assert.equal(companyKey("Tech Solutions"), "tech");
    assert.equal(companyKey("Prima Systems"), "prima");
  });

  test("a lead's key is worked out from its name, not an older stored key", () => {
    assert.equal(leadCompanyKey({ company: "Nessovo Technologies", sourceData: { companyKey: "nessovo technologies" } }), "nessovo");
    assert.equal(leadCompanyKey({ name: null, company: null, sourceData: { companyKey: "kept" } }), "kept");
    const dups = findDuplicateCompanies([
      { id: "1", company: "Nessovo", createdAt: "2026-10-09T00:00:00Z", sourceData: { companyKey: "nessovo" } },
      { id: "2", company: "Nessovo solutions", createdAt: "2026-10-09T00:01:00Z", sourceData: { companyKey: "nessovo solutions" } },
      { id: "3", company: "Nessovo Technologies", createdAt: "2026-10-09T00:02:00Z", sourceData: { companyKey: "nessovo technologies" } },
    ]);
    assert.equal(dups.length, 1);
    assert.equal(dups[0].keep.id, "1");
    assert.deepEqual(dups[0].merge.map((l) => l.id), ["2", "3"]);
  });
});

// ─── LinkedIn CSV import (was csv.test.js) ───
describe("LinkedIn CSV import", () => {
  test("parseCsv keeps commas, quotes and line breaks inside quoted cells", () => {
    const rows = parseCsv('a,"b, c","say ""hi""","two\nlines"\r\n1,2,3,4\n');
    assert.deepEqual(rows, [
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["1", "2", "3", "4"],
    ]);
  });

  test("reads a LinkedIn export with headers, joining first and last name", () => {
    const csv = "First Name,Last Name,Company,Title,LinkedIn URL\nAli,Khan,\"Arbisoft, Inc.\",CTO,https://www.linkedin.com/in/alikhan\n";
    const { rows, skipped } = readLinkedInLeadsCsv(csv);
    assert.equal(skipped, 0);
    assert.deepEqual(rows, [
      { url: "https://www.linkedin.com/in/alikhan", name: "Ali Khan", title: "CTO", company: "Arbisoft, Inc." },
    ]);
  });

  test("reads a plain list of URLs without a header", () => {
    const { rows, skipped } = readLinkedInLeadsCsv("https://www.linkedin.com/in/one\nhttps://linkedin.com/in/two, extra\nnot a url\n");
    assert.deepEqual(rows.map((r) => r.url), ["https://www.linkedin.com/in/one", "https://linkedin.com/in/two"]);
    assert.equal(skipped, 1);
  });

  test("skips rows without a LinkedIn profile URL", () => {
    const { rows, skipped } = readLinkedInLeadsCsv("name,url\nA,https://example.com\nB,https://www.linkedin.com/in/b\n");
    assert.equal(rows.length, 1);
    assert.equal(skipped, 1);
  });
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
