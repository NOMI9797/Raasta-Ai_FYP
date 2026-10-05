import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANDIDATE_STATUS, STATUS_META, KANBAN_STAGES, MANUAL_TRANSITIONS, ALL_STATUSES, canTransition,
  INTERVIEW_STATUS, INTERVIEW_STATUS_META, allowedMovesToStage,
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

test("every interview status has a label and badge", () => {
  assert.deepEqual(Object.keys(INTERVIEW_STATUS_META).sort(), Object.values(INTERVIEW_STATUS).sort());
  for (const meta of Object.values(INTERVIEW_STATUS_META)) assert.ok(meta.label && meta.badge);
});

test("allowedMovesToStage lists the statuses a card may be dropped on", () => {
  // One option: apply directly
  assert.deepEqual(allowedMovesToStage("new", "shortlisted"), ["shortlisted"]);
  assert.deepEqual(allowedMovesToStage("interview_completed", "decision"), ["final_shortlisted", "final_rejected"]);
  // Two options in the target column: the board asks
  assert.deepEqual(allowedMovesToStage("new", "closed"), ["not_shortlisted", "rejected"]);
  // Nothing allowed: the board refuses (invites and interviews are not manual moves)
  assert.deepEqual(allowedMovesToStage("shortlisted", "interview"), []);
  assert.deepEqual(allowedMovesToStage("hired", "applied"), []);
  assert.deepEqual(allowedMovesToStage("interview_in_progress", "closed"), []);
  // Every move offered is a legal manual transition into a status of that stage
  for (const from of ALL_STATUSES) {
    for (const stage of KANBAN_STAGES.map((s) => s.value)) {
      for (const to of allowedMovesToStage(from, stage)) {
        assert.ok(canTransition(from, to));
        assert.equal(STATUS_META[to].stage, stage);
      }
    }
  }
});
