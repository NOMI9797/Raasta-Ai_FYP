import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POST_PLATFORMS, PLATFORM_SPECS, buildPostPrompt, composerHandoffUrl, finalizePost, generatePlatformPost, getPlatformSpec, validatePost,
} from "../../libs/hiring/platform-content";

const job = {
  title: "Senior Backend Engineer",
  requiredSkills: ["Node.js", "PostgreSQL"],
  techStack: ["Redis"],
  experienceRange: "3-5 years",
  location: "Lahore",
  locationType: "hybrid",
  employmentType: "full-time",
  salaryMin: 300000,
  salaryMax: 450000,
  salaryCurrency: "PKR",
};
const APPLY = "https://raasta.example/apply/abc";

test("every supported platform has a spec with the saved-post column and a limit", () => {
  assert.deepEqual(POST_PLATFORMS, ["linkedin", "rozee"]);
  for (const id of POST_PLATFORMS) {
    assert.ok(PLATFORM_SPECS[id].field);
    assert.ok(PLATFORM_SPECS[id].maxChars > 0);
  }
  assert.throws(() => getPlatformSpec("indeed"), /Unknown platform/);
});

test("LinkedIn: markdown is removed, extra hashtags dropped, the apply link goes before the hashtags", () => {
  const raw = "**We need a backend engineer** \u{1F680}\n\n- Node.js\n* PostgreSQL\n\n#hiring #node #postgres #redis #backend #jobs #lahore";
  const { text, warnings } = finalizePost("linkedin", raw, { applyUrl: APPLY });
  assert.ok(!text.includes("**"));
  assert.ok(text.includes("\u{1F680}"), "emoji stays on LinkedIn");
  assert.ok(text.includes("- PostgreSQL"), "bullets are normalised to dashes");
  assert.equal((text.match(/#\w+/g) || []).length, 5);
  const lines = text.split("\n");
  assert.match(lines[lines.length - 1], /^#hiring/, "hashtags stay on the last line");
  assert.ok(text.indexOf(APPLY) > -1 && text.indexOf(APPLY) < text.indexOf("#hiring"));
  assert.ok(warnings.includes("Hashtags limited to 5"));
  assert.ok(warnings.includes("Apply link added"));
});

test("Rozee: emojis and hashtags are removed and the apply link is added at the end", () => {
  const raw = "About the role \u{1F680}\n- Build APIs #hiring\n\nRequirements\n- Node.js";
  const { text, warnings } = finalizePost("rozee", raw, { applyUrl: APPLY });
  assert.ok(!/\p{Extended_Pictographic}/u.test(text));
  assert.ok(!text.includes("#"));
  assert.ok(text.endsWith(`How to apply: ${APPLY}`));
  assert.ok(warnings.some((w) => /Emojis removed/.test(w)));
  assert.ok(warnings.some((w) => /Hashtags removed/.test(w)));
});

test("an apply link that is already there is not added twice, and a clean post has no warnings", () => {
  const raw = `Join us\n\nApply here: ${APPLY}\n\n#node`;
  const { text, warnings } = finalizePost("linkedin", raw, { applyUrl: APPLY });
  assert.equal(text.split(APPLY).length - 1, 1);
  assert.deepEqual(warnings, []);
});

test("a post over the limit is cut at a paragraph and says so", () => {
  const paragraph = "word ".repeat(100).trim();
  const raw = Array.from({ length: 12 }, () => paragraph).join("\n\n");
  const { text, warnings } = finalizePost("linkedin", raw);
  assert.ok(text.length <= PLATFORM_SPECS.linkedin.maxChars);
  assert.ok(text.length > PLATFORM_SPECS.linkedin.maxChars * 0.6);
  assert.ok(!text.endsWith(" "));
  assert.ok(warnings.some((w) => /Shortened/.test(w)));
});

test("validatePost refuses an empty or oversized post", () => {
  assert.match(validatePost("linkedin", "")[0], /no LinkedIn post/);
  assert.match(validatePost("rozee", "x".repeat(4001))[0], /limit is 4000/);
  assert.deepEqual(validatePost("rozee", "A fine ad"), []);
});

test("prompts differ per platform and carry the job facts and apply link", () => {
  const linkedin = buildPostPrompt("linkedin", job, { tone: "casual", applyUrl: APPLY });
  const rozee = buildPostPrompt("rozee", job, { applyUrl: APPLY });
  assert.match(linkedin.system, /hashtags/i);
  assert.match(linkedin.system, /friendly/);
  assert.match(rozee.system, /Rozee\.pk/);
  assert.match(rozee.system, /No emojis, no hashtags/);
  for (const prompt of [linkedin, rozee]) {
    assert.match(prompt.user, /Senior Backend Engineer/);
    assert.match(prompt.user, /Node\.js, PostgreSQL/);
    assert.match(prompt.user, /PKR 300000 - 450000/);
    assert.ok(prompt.user.includes(APPLY));
    assert.match(prompt.system, /Never invent/);
  }
  assert.match(buildPostPrompt("linkedin", { title: "Designer" }).user, /Salary: not disclosed/);
  assert.throws(() => buildPostPrompt("indeed", job), /Unknown platform/);
});

test("generatePlatformPost asks the model with the platform prompt and cleans the answer", async () => {
  const calls = [];
  const chat = async (request) => {
    calls.push(request);
    return "## Hiring a backend engineer\n\nBuild APIs.\n\n#node";
  };
  const result = await generatePlatformPost({ job, platform: "linkedin", applyUrl: APPLY, chat });
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /LinkedIn/);
  assert.ok(!result.text.startsWith("#"));
  assert.ok(result.text.includes(APPLY));
  await assert.rejects(generatePlatformPost({ job, platform: "rozee", chat: async () => "   " }), /did not return a Rozee.pk post/);
});

test("an empty answer is asked for once more; two empty answers fail instead of returning only the apply link", async () => {
  const answers = ["", "Join our team as a backend engineer. Build APIs with Node.js and PostgreSQL in Lahore."];
  let asked = 0;
  const result = await generatePlatformPost({ job, platform: "linkedin", applyUrl: APPLY, chat: async () => answers[asked++] });
  assert.equal(asked, 2);
  assert.match(result.text, /backend engineer/);

  let calls = 0;
  await assert.rejects(generatePlatformPost({ job, platform: "linkedin", applyUrl: APPLY, chat: async () => (calls++, "") }), /did not return a LinkedIn post/);
  assert.equal(calls, 2);
});

test("the LinkedIn hand-off link fills the composer; Rozee points at the post-a-job form", () => {
  const url = composerHandoffUrl("linkedin", "Hello & welcome #1");
  assert.ok(url.startsWith("https://www.linkedin.com/feed/?shareActive=true&text="));
  assert.equal(decodeURIComponent(url.split("text=")[1]), "Hello & welcome #1");
  assert.equal(composerHandoffUrl("rozee", "anything"), PLATFORM_SPECS.rozee.composerUrl);
  assert.equal(composerHandoffUrl("linkedin", ""), PLATFORM_SPECS.linkedin.composerUrl);
});
