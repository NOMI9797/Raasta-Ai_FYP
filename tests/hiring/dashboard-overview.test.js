import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignStatus, summariseCandidates } from "../../libs/dashboard/overview";
import { CANDIDATE_STATUS as S } from "../../libs/hiring/statuses";
import { timeAgo } from "../../components/layout/notification-utils";

test("candidate numbers: the funnel is cumulative and the waiting counts are per status", () => {
  const out = summariseCandidates({
    [S.NEW]: 4, [S.SCREENED]: 3, [S.REVIEWED]: 1, [S.NOT_SHORTLISTED]: 2,
    [S.SHORTLISTED]: 2, [S.INTERVIEW_INVITED]: 1, [S.INTERVIEW_IN_PROGRESS]: 1, [S.INTERVIEW_EXPIRED]: 1,
    [S.INTERVIEW_COMPLETED]: 2, [S.FINAL_SHORTLISTED]: 1, [S.HIRED]: 1, [S.REJECTED]: 1,
  });
  assert.equal(out.total, 20);
  assert.equal(out.unscreened, 4);
  assert.equal(out.waitingForShortlist, 4); // screened + reviewed
  assert.equal(out.interviewing, 2);
  assert.equal(out.awaitingDecision, 2);
  assert.equal(out.expiredInvites, 1);
  assert.deepEqual(out.funnel, { applied: 20, shortlisted: 9, interviewed: 4, final: 2 });
});

test("candidate numbers: no candidates gives zeros, not undefined", () => {
  const out = summariseCandidates();
  assert.equal(out.total, 0);
  assert.deepEqual(out.funnel, { applied: 0, shortlisted: 0, interviewed: 0, final: 0 });
});

test("campaign status follows its leads", () => {
  assert.equal(campaignStatus({ leads: 0, processed: 0 }), "draft");
  assert.equal(campaignStatus({ leads: 5, processed: 0 }), "active");
  assert.equal(campaignStatus({ leads: 5, processed: 3 }), "active");
  assert.equal(campaignStatus({ leads: 5, processed: 5 }), "completed");
  assert.equal(campaignStatus({}), "draft");
});

test("time ago rounds down and moves through minutes, hours and days", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const ago = (ms) => timeAgo(new Date(now - ms), now);
  const min = 60 * 1000;
  assert.equal(ago(20 * 1000), "just now");
  assert.equal(ago(59 * 1000), "just now");
  assert.equal(ago(89 * 1000), "1m ago");
  assert.equal(ago(59 * min + 59 * 1000), "59m ago");
  assert.equal(ago(3 * 60 * min + 59 * min), "3h ago"); // 3h59m is not "4h ago"
  assert.equal(ago(2 * 24 * 60 * min), "2d ago");
});

test("a time in the future is not reported as 'just now' (a database clock hours ahead of UTC)", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const fiveHoursAhead = new Date(now + 5 * 60 * 60 * 1000);
  assert.notEqual(timeAgo(fiveHoursAhead, now), "just now");
  // a few seconds of drift between two machines is still "just now"
  assert.equal(timeAgo(new Date(now + 30 * 1000), now), "just now");
});

test("an invalid date gives an empty string instead of 'NaN'", () => {
  assert.equal(timeAgo("not a date"), "");
});
