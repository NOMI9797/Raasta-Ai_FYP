import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HIRING_CONFIG, getHiringConfig, validateHiringConfig } from "../../libs/hiring/config";

test("getHiringConfig fills defaults and merges finalWeights", () => {
  assert.deepEqual(getHiringConfig(null), DEFAULT_HIRING_CONFIG);
  const c = getHiringConfig({ hiringConfig: { minFitScore: 80, finalWeights: { resume: 0.5 } } });
  assert.equal(c.minFitScore, 80);
  assert.deepEqual(c.finalWeights, { resume: 0.5, interview: 0.5, communication: 0.2 });
  assert.notEqual(c.finalWeights, DEFAULT_HIRING_CONFIG.finalWeights); // no shared mutation
});

test("validateHiringConfig accepts defaults unchanged", () => {
  const { config, errors } = validateHiringConfig({});
  assert.deepEqual(errors, []);
  assert.deepEqual(config, DEFAULT_HIRING_CONFIG);
});

test("validateHiringConfig normalises weights to sum 1", () => {
  const { config, errors } = validateHiringConfig({ finalWeights: { resume: 2, interview: 1, communication: 1 } });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.finalWeights, { resume: 0.5, interview: 0.25, communication: 0.25 });
});

test("validateHiringConfig reports out-of-range values and drops unknown keys", () => {
  const { config, errors } = validateHiringConfig({
    minFitScore: 120,
    questionCount: 2,
    interviewMaxMinutes: 150,
    maxShortlist: 0,
    autoInvite: "yes",
    finalWeights: { resume: 0, interview: 0, communication: 0 },
    hacker: true,
  });
  assert.equal(errors.length, 6);
  assert.ok(errors.some((e) => e.startsWith("minFitScore")));
  assert.ok(errors.some((e) => e.startsWith("questionCount")));
  assert.ok(errors.some((e) => e.startsWith("interviewMaxMinutes")));
  assert.ok(errors.some((e) => e.startsWith("maxShortlist")));
  assert.ok(errors.some((e) => e.startsWith("autoInvite")));
  assert.ok(errors.some((e) => e.startsWith("finalWeights")));
  assert.equal("hacker" in config, false);
});

test("validateHiringConfig allows maxShortlist null (no cap)", () => {
  const { config, errors } = validateHiringConfig({ maxShortlist: null });
  assert.deepEqual(errors, []);
  assert.equal(config.maxShortlist, null);
});

test("validateHiringConfig rejects non-objects", () => {
  assert.deepEqual(validateHiringConfig("nope").errors, ["hiringConfig must be an object"]);
  assert.deepEqual(validateHiringConfig([1]).errors, ["hiringConfig must be an object"]);
});
