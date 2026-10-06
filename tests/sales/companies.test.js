import { test } from "node:test";
import assert from "node:assert/strict";
import { companyKey, findDuplicateCompanies, groupProfilesByCompany, jobsOf, mergeJobs } from "../../libs/sales/companies";

test("companyKey ignores case, punctuation and legal suffixes", () => {
  assert.equal(companyKey("Cubix Inc."), "cubix");
  assert.equal(companyKey("CUBIX (Pvt) Ltd"), "cubix");
  assert.equal(companyKey("Datamatics Global Services Ltd"), "datamatics global services");
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
