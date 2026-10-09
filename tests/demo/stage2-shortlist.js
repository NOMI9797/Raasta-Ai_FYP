// Stage 2: shortlist rules, per-job settings and the candidate status machine (docs/ai-hiring/06 §3, 05 §1 and §8).
// Real code, no database: decideShortlist() is the pure rule the database shortlist uses.
import assert from "node:assert/strict";
import { decideShortlist } from "../../libs/hiring/shortlist";
import { DEFAULT_HIRING_CONFIG, getHiringConfig, validateHiringConfig } from "../../libs/hiring/config";
import {
  ALL_STATUSES, CANDIDATE_STATUS as S, KANBAN_STAGES, MANUAL_TRANSITIONS, STATUS_META, canTransition,
} from "../../libs/hiring/statuses";
import { SCRIPTED_FIT } from "./fixtures";

const day = (n) => new Date(Date.UTC(2026, 9, n, 9, 0, 0)).toISOString();
// Applicants in the order they applied; the scanned PDF scores 0 (S1-13)
const NAMES = {
  "ayesha.khan@example.com": "Ayesha", "bilal.qureshi@example.com": "Bilal", "sara.ahmed@example.com": "Sara",
  "usman.tariq@example.com": "Usman", "hamza.sheikh@example.com": "Hamza", "fatima.noor@example.com": "Fatima",
  "zara.malik@example.com": "Zara", "omar.farooq@example.com": "Omar",
};
const POOL = [
  ...Object.entries(SCRIPTED_FIT).map(([email, fitScore], i) => ({ id: NAMES[email], fitScore, appliedAt: day(i + 1) })),
  { id: "Scanned", fitScore: 0, appliedAt: day(9) },
];
const names = (ids) => (ids.length ? ids.join(", ") : "nobody");
const make = (scores, startDay = 1) => scores.map((fitScore, i) => ({ id: `c${i + 1}:${fitScore}`, fitScore, appliedAt: day(startDay + i) }));

export default {
  id: 2,
  title: "Shortlist rules, settings and status machine",
  tier: "offline",
  intro: "Who goes forward, who does not, and which moves is a recruiter allowed to make by hand?",
  cases: [
    {
      id: "S2-01",
      title: "Nine applicants, threshold 70, top 3: the three strong candidates are shortlisted",
      requirement: "Shortlist = best fit first, while fit >= minFitScore and the cap allows (06 §3).",
      input: "scores Ayesha 92, Bilal 85, Sara 78, Usman 55, Hamza 52, Fatima 38, Zara 8, Omar 5, scanned 0; minFitScore 70, maxShortlist 3",
      expect: "shortlisted Ayesha, Bilal, Sara; the other six not shortlisted",
      run: async () => {
        const { shortlisted, notShortlisted } = decideShortlist(POOL, { minFitScore: 70, maxShortlist: 3 });
        assert.deepEqual(shortlisted, ["Ayesha", "Bilal", "Sara"]);
        assert.deepEqual(notShortlisted, ["Usman", "Hamza", "Fatima", "Zara", "Omar", "Scanned"]);
        return `shortlisted: ${names(shortlisted)} · not: ${names(notShortlisted)}`;
      },
    },
    {
      id: "S2-02",
      title: "The threshold is inclusive: 70 goes through, 69 does not",
      requirement: "minFitScore means \"at least\".",
      input: "scores 70 and 69, minFitScore 70",
      expect: "the 70 is shortlisted, the 69 is not",
      run: async () => {
        const { shortlisted, notShortlisted } = decideShortlist(make([70, 69]), { minFitScore: 70, maxShortlist: 5 });
        assert.deepEqual(shortlisted, ["c1:70"]);
        assert.deepEqual(notShortlisted, ["c2:69"]);
        return `shortlisted ${names(shortlisted)} · not ${names(notShortlisted)}`;
      },
    },
    {
      id: "S2-03",
      title: "The cap wins: five qualify but only the top three go through",
      requirement: "maxShortlist limits how many interviews are sent (06 §3).",
      input: "scores 82, 90, 84, 88, 86; minFitScore 70, maxShortlist 3",
      expect: "90, 88, 86 shortlisted; 84 and 82 are not even though they qualify",
      run: async () => {
        const { shortlisted, notShortlisted } = decideShortlist(make([82, 90, 84, 88, 86]), { minFitScore: 70, maxShortlist: 3 });
        assert.deepEqual(shortlisted.map((id) => id.split(":")[1]), ["90", "88", "86"]);
        assert.deepEqual(notShortlisted.map((id) => id.split(":")[1]), ["84", "82"]);
        return `shortlisted ${shortlisted.map((id) => id.split(":")[1]).join(", ")} · cut by the cap ${notShortlisted.map((id) => id.split(":")[1]).join(", ")}`;
      },
    },
    {
      id: "S2-04",
      title: "A tie goes to whoever applied first",
      requirement: "Fair tie-break: earliest application wins the last slot.",
      input: "two candidates at 80 (applied day 5 and day 2), one slot left",
      expect: "the day-2 applicant is shortlisted",
      run: async () => {
        const pool = [
          { id: "late", fitScore: 80, appliedAt: day(5) },
          { id: "early", fitScore: 80, appliedAt: day(2) },
        ];
        const { shortlisted, notShortlisted } = decideShortlist(pool, { minFitScore: 70, maxShortlist: 1 });
        assert.deepEqual(shortlisted, ["early"]);
        assert.deepEqual(notShortlisted, ["late"]);
        return `shortlisted ${names(shortlisted)}, not ${names(notShortlisted)}`;
      },
    },
    {
      id: "S2-05",
      title: "People already shortlisted use up the cap",
      requirement: "Re-running the shortlist later must not exceed maxShortlist (06 §3).",
      input: "maxShortlist 3, two already shortlisted, new scores 95 and 90",
      expect: "only the 95 is shortlisted",
      run: async () => {
        const { shortlisted, notShortlisted } = decideShortlist(make([90, 95]), { minFitScore: 70, maxShortlist: 3 }, 2);
        assert.deepEqual(shortlisted, ["c2:95"]);
        assert.deepEqual(notShortlisted, ["c1:90"]);
        return `shortlisted ${names(shortlisted)} · not ${names(notShortlisted)}`;
      },
    },
    {
      id: "S2-06",
      title: "Nobody reaches the threshold: nobody is shortlisted",
      requirement: "The system never lowers the bar by itself.",
      input: "scores 65, 40, 10; minFitScore 70",
      expect: "empty shortlist, all three not shortlisted",
      run: async () => {
        const { shortlisted, notShortlisted } = decideShortlist(make([65, 40, 10]), { minFitScore: 70, maxShortlist: 5 });
        assert.equal(shortlisted.length, 0);
        assert.equal(notShortlisted.length, 3);
        return `shortlisted ${shortlisted.length}, not shortlisted ${notShortlisted.length}`;
      },
    },
    {
      id: "S2-07",
      title: "maxShortlist null means no cap",
      requirement: "A recruiter can leave the cap off.",
      input: "30 candidates all scoring 80, maxShortlist null",
      expect: "all 30 shortlisted",
      run: async () => {
        const { shortlisted } = decideShortlist(make(Array(30).fill(80)), { minFitScore: 70, maxShortlist: null });
        assert.equal(shortlisted.length, 30);
        return `${shortlisted.length} shortlisted`;
      },
    },
    {
      id: "S2-08",
      title: "Settings a recruiter types are validated; weights are normalised",
      requirement: "A bad setting is refused with every problem listed; weights always sum to 1 (05 §1).",
      input: "minFitScore 150 · maxShortlist 0 · weights 3/5/2 · an unknown key",
      expect: "errors for 150 and 0; weights become 0.3/0.5/0.2; the unknown key is dropped",
      run: async () => {
        const bad = validateHiringConfig({ minFitScore: 150, maxShortlist: 0 });
        assert.ok(bad.errors.some((e) => e.startsWith("minFitScore")));
        assert.ok(bad.errors.some((e) => e.startsWith("maxShortlist")));
        const good = validateHiringConfig({ finalWeights: { resume: 3, interview: 5, communication: 2 }, hackerKey: true });
        assert.deepEqual(good.errors, []);
        assert.deepEqual(good.config.finalWeights, { resume: 0.3, interview: 0.5, communication: 0.2 });
        assert.equal("hackerKey" in good.config, false);
        return `${bad.errors.length} errors for the bad input · weights ${JSON.stringify(good.config.finalWeights)} · unknown key dropped`;
      },
    },
    {
      id: "S2-09",
      title: "A new job is safe by default: a human decides rejections",
      requirement: "Hard rule 6: no automatic final decisions unless the recruiter turns autoFinalize on.",
      input: "a job with no hiring settings",
      expect: "autoFinalize false, minFitScore 70, finalThreshold 70, weights 0.3/0.5/0.2, outcome emails off",
      run: async () => {
        const c = getHiringConfig({});
        assert.equal(c.autoFinalize, false);
        assert.equal(c.minFitScore, 70);
        assert.equal(c.finalThreshold, 70);
        assert.deepEqual(c.finalWeights, { resume: 0.3, interview: 0.5, communication: 0.2 });
        assert.equal(c.sendOutcomeEmails, false);
        assert.equal(DEFAULT_HIRING_CONFIG.autoFinalize, false);
        return `autoFinalize=${c.autoFinalize}, minFitScore=${c.minFitScore}, finalThreshold=${c.finalThreshold}, outcome emails=${c.sendOutcomeEmails}`;
      },
    },
    {
      id: "S2-10",
      title: "Recruiter moves are limited: no skipping the interview, no editing a hire",
      requirement: "The status machine blocks illegal moves (05 §8).",
      input: "interview_completed→hired, interview_in_progress→rejected, hired→rejected, final_shortlisted→hired, rejected→shortlisted",
      expect: "first three refused; last two allowed",
      run: async () => {
        assert.equal(canTransition(S.INTERVIEW_COMPLETED, S.HIRED), false);
        assert.equal(canTransition(S.INTERVIEW_IN_PROGRESS, S.REJECTED), false);
        assert.equal(canTransition(S.HIRED, S.REJECTED), false);
        assert.equal(canTransition(S.FINAL_SHORTLISTED, S.HIRED), true);
        assert.equal(canTransition(S.REJECTED, S.SHORTLISTED), true);
        return "completed→hired ✗ · in-progress→rejected ✗ · hired→rejected ✗ · final shortlist→hired ✓ · rejected→shortlisted ✓";
      },
    },
    {
      id: "S2-11",
      title: "Every status has a label, colour and Kanban column; no move leads nowhere",
      requirement: "The UI never meets a status it cannot draw (05 §8).",
      input: `${ALL_STATUSES.length} statuses and ${KANBAN_STAGES.length} Kanban stages`,
      expect: "all statuses have metadata with a valid stage; every allowed target is a known status",
      run: async () => {
        const stages = new Set(KANBAN_STAGES.map((s) => s.value));
        for (const status of ALL_STATUSES) {
          const meta = STATUS_META[status];
          assert.ok(meta.label && meta.badge && stages.has(meta.stage), `${status} metadata`);
        }
        for (const [from, targets] of Object.entries(MANUAL_TRANSITIONS)) {
          assert.ok(ALL_STATUSES.includes(from), `unknown source ${from}`);
          for (const to of targets) assert.ok(ALL_STATUSES.includes(to), `${from} → unknown ${to}`);
        }
        return `${ALL_STATUSES.length} statuses checked, ${Object.values(MANUAL_TRANSITIONS).flat().length} allowed moves checked`;
      },
    },
    {
      id: "S2-12",
      title: "The happy path only ever moves forward across the Kanban columns",
      requirement: "applied → shortlisted → interview → evaluation → decision (01).",
      input: "new → screened → shortlisted → interview_invited → interview_in_progress → interview_completed → final_shortlisted → hired",
      expect: "column order never decreases",
      run: async () => {
        const path = [S.NEW, S.SCREENED, S.SHORTLISTED, S.INTERVIEW_INVITED, S.INTERVIEW_IN_PROGRESS, S.INTERVIEW_COMPLETED, S.FINAL_SHORTLISTED, S.HIRED];
        const order = KANBAN_STAGES.map((s) => s.value);
        const columns = path.map((status) => order.indexOf(STATUS_META[status].stage));
        for (let i = 1; i < columns.length; i += 1) assert.ok(columns[i] >= columns[i - 1], `${path[i]} moved backwards`);
        return path.map((status) => STATUS_META[status].stage).join(" → ");
      },
    },
  ],
};
