import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANDIDATE_STATUS, STATUS_META, KANBAN_STAGES, MANUAL_TRANSITIONS, ALL_STATUSES, canTransition,
} from "../../libs/hiring/statuses";

test("every status constant has metadata and a valid Kanban stage", () => {
  const stages = new Set(KANBAN_STAGES.map((s) => s.value));
  for (const status of Object.values(CANDIDATE_STATUS)) {
    assert.ok(STATUS_META[status], `missing STATUS_META for ${status}`);
    assert.ok(stages.has(STATUS_META[status].stage), `bad stage for ${status}`);
  }
  assert.deepEqual([...ALL_STATUSES].sort(), Object.values(CANDIDATE_STATUS).sort());
});

test("transitions only point at known statuses and fit the varchar(30) column", () => {
  for (const [from, targets] of Object.entries(MANUAL_TRANSITIONS)) {
    assert.ok(STATUS_META[from], `unknown source ${from}`);
    for (const to of targets) assert.ok(STATUS_META[to], `unknown target ${from} -> ${to}`);
  }
  for (const status of ALL_STATUSES) assert.ok(status.length <= 30, status);
});

test("canTransition follows MANUAL_TRANSITIONS", () => {
  assert.equal(canTransition("new", "shortlisted"), true);
  assert.equal(canTransition("interview_completed", "final_shortlisted"), true);
  assert.equal(canTransition("interview_in_progress", "rejected"), false);
  assert.equal(canTransition("new", "hired"), false);
  assert.equal(canTransition("not_a_status", "new"), false);
});
