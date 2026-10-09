import { test } from "node:test";
import assert from "node:assert/strict";
import { companyKey, findDuplicateCompanies, leadCompanyKey, groupProfilesByCompany, jobsOf, mergeJobs } from "../../libs/sales/companies";

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
