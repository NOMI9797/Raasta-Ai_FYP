import { test } from "node:test";
import assert from "node:assert/strict";
import { KIT_PLATFORMS, KIT_TTL_MS, KIT_VERSION, buildPostingKit } from "../../libs/hiring/posting-kit";

const NOW = new Date("2026-10-06T10:00:00.000Z");
const job = {
  id: "job-1",
  title: "Senior Backend Engineer",
  requiredSkills: ["Node.js", "PostgreSQL"],
  techStack: ["Redis", "node.js"],
  experienceRange: "3-5 years",
  location: "Lahore",
  locationType: "hybrid",
  employmentType: "full-time",
  salaryMin: 300000,
  salaryMax: 450000,
  salaryCurrency: "PKR",
};
const POST = "Senior Backend Engineer in Lahore\n\nAbout the role\n- Build APIs";
const field = (kit, key) => kit.fields.find((f) => f.key === key)?.value;

test("a kit carries the form fields in the order a job form asks for them, ready to copy", () => {
  const kit = buildPostingKit({ job, platform: "indeed", postText: POST, applyUrl: "https://raasta.example/apply/job-1", now: NOW });
  assert.equal(kit.version, KIT_VERSION);
  assert.equal(kit.platform, "indeed");
  assert.equal(kit.platformLabel, "Indeed");
  assert.equal(kit.jobId, "job-1");
  assert.equal(kit.entryUrl, "https://employers.indeed.com/jobs");
  assert.deepEqual(kit.fields.map((f) => f.key), [
    "title", "location", "workplace", "employmentType", "experience", "salary", "salaryMin", "salaryMax", "currency", "skills", "description", "applyUrl",
  ]);
  assert.equal(field(kit, "title"), "Senior Backend Engineer");
  assert.equal(field(kit, "workplace"), "Hybrid");
  assert.equal(field(kit, "employmentType"), "Full-time");
  assert.equal(field(kit, "salary"), "PKR 300000 - 450000");
  assert.equal(field(kit, "salaryMin"), "300000");
  assert.equal(field(kit, "currency"), "PKR");
  assert.equal(field(kit, "description"), POST);
  assert.equal(field(kit, "applyUrl"), "https://raasta.example/apply/job-1");
  assert.equal(kit.place, "Lahore - Hybrid");
});

test("skills are the required skills and the tech stack, with exact repeats removed", () => {
  const kit = buildPostingKit({ job, platform: "rozee", postText: POST, now: NOW });
  // exact duplicates are removed; the list is shown as the recruiter wrote it
  assert.equal(field(kit, "skills"), "Node.js, PostgreSQL, Redis, node.js");
});

test("empty values are left out, so the panel never offers to copy nothing", () => {
  const kit = buildPostingKit({ job: { id: "j", title: "Designer" }, platform: "rozee", postText: "  ", now: NOW });
  assert.deepEqual(kit.fields.map((f) => f.key), ["title"]);
  const salaryOnlyMax = buildPostingKit({ job: { id: "j", title: "X", salaryMax: 90000 }, platform: "indeed", postText: POST, now: NOW });
  assert.equal(field(salaryOnlyMax, "salary"), "USD 90000");
  assert.equal(field(salaryOnlyMax, "salaryMin"), undefined);
});

test("a kit expires, so an old one is not offered days later", () => {
  const kit = buildPostingKit({ job, platform: "indeed", postText: POST, now: NOW });
  assert.equal(new Date(kit.expiresAt).getTime() - NOW.getTime(), KIT_TTL_MS);
  assert.equal(KIT_TTL_MS, 2 * 60 * 60 * 1000);
});

test("only the platforms posted to by hand have a kit; very long text is cut", () => {
  assert.deepEqual([...KIT_PLATFORMS], ["indeed", "rozee"]);
  assert.throws(() => buildPostingKit({ job, platform: "linkedin", postText: POST }), /No posting kit/);
  const long = buildPostingKit({ job, platform: "indeed", postText: "x".repeat(20000), now: NOW });
  assert.equal(field(long, "description").length, 8000);
});

test("Indeed gets a clean title and keeps the original to copy; other platforms keep the title as written", async () => {
  const { indeedTitle } = await import("../../libs/hiring/posting-kit");
  const stackJob = { ...job, title: "Full Stack Developer (Node.js / React)" };
  const indeed = buildPostingKit({ job: stackJob, platform: "indeed", postText: POST, now: NOW });
  assert.equal(field(indeed, "title"), "Full Stack Developer");
  assert.equal(field(indeed, "titleAsWritten"), "Full Stack Developer (Node.js / React)");
  const rozee = buildPostingKit({ job: stackJob, platform: "rozee", postText: POST, now: NOW });
  assert.equal(field(rozee, "title"), "Full Stack Developer (Node.js / React)");
  assert.equal(field(rozee, "titleAsWritten"), undefined);
  // a title that needs no cleaning has no second row
  assert.equal(field(buildPostingKit({ job, platform: "indeed", postText: POST, now: NOW }), "titleAsWritten"), undefined);

  assert.equal(indeedTitle("Senior C++ Developer"), "Senior C++ Developer");
  assert.equal(indeedTitle("C# .NET Engineer"), "C# .NET Engineer");
  assert.equal(indeedTitle("SALES!!! Executive $$$"), "SALES Executive");
  assert.equal(indeedTitle("QA Engineer [Remote] - Lahore"), "QA Engineer - Lahore");
  assert.equal(indeedTitle("Data Scientist \u{1F680}"), "Data Scientist");
  assert.equal(indeedTitle("Sales / Marketing Executive"), "Sales / Marketing Executive");
  assert.equal(indeedTitle("(Temp)"), "(Temp)", "a title that would be left empty is kept as written");
  const long = indeedTitle("A very long job title that keeps going and going well past sixty characters in total length");
  assert.ok(long.length <= 60 && !long.endsWith(" "));
});
