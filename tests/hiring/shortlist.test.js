import { test } from "node:test";
import assert from "node:assert/strict";
import { decideShortlist } from "../../libs/hiring/shortlist";

const c = (id, fitScore, appliedAt) => ({ id, fitScore, appliedAt: new Date(appliedAt) });
const pool = [
  c("a", 92, "2026-01-05"), c("b", 88, "2026-01-02"), c("c", 81, "2026-01-03"),
  c("d", 79, "2026-01-01"), c("e", 65, "2026-01-04"), c("f", 30, "2026-01-06"),
];

test("threshold only (no cap): everyone at or above minFitScore", () => {
  const r = decideShortlist(pool, { minFitScore: 70, maxShortlist: null });
  assert.deepEqual(r.shortlisted, ["a", "b", "c", "d"]);
  assert.deepEqual(r.notShortlisted, ["e", "f"]);
});

test("top-N cap: exactly the best N above the threshold", () => {
  const r = decideShortlist(pool, { minFitScore: 70, maxShortlist: 3 });
  assert.deepEqual(r.shortlisted, ["a", "b", "c"]);
  assert.deepEqual(r.notShortlisted, ["d", "e", "f"]);
});

test("already shortlisted candidates count towards the cap", () => {
  const r = decideShortlist(pool, { minFitScore: 70, maxShortlist: 3 }, 2);
  assert.deepEqual(r.shortlisted, ["a"]);
  assert.equal(decideShortlist(pool, { minFitScore: 70, maxShortlist: 3 }, 3).shortlisted.length, 0);
});

test("ties are broken by earliest application", () => {
  const tied = [c("late", 80, "2026-02-02"), c("early", 80, "2026-02-01"), c("mid", 80, "2026-02-01T12:00")];
  assert.deepEqual(decideShortlist(tied, { minFitScore: 0, maxShortlist: 2 }).shortlisted, ["early", "mid"]);
});

test("score exactly at the threshold is shortlisted; nobody qualifies -> none", () => {
  assert.deepEqual(decideShortlist([c("x", 70, "2026-01-01")], { minFitScore: 70, maxShortlist: 5 }).shortlisted, ["x"]);
  assert.deepEqual(decideShortlist(pool, { minFitScore: 95, maxShortlist: 5 }).shortlisted, []);
  assert.deepEqual(decideShortlist([], { minFitScore: 70, maxShortlist: 5 }), { shortlisted: [], notShortlisted: [] });
});
