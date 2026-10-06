import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSalesGuidance } from "../../libs/sales/guidance";

const empty = { linkedinAccounts: 0, rozeeAccounts: 0, campaigns: 0, leads: 0, researchedLeads: 0, messages: 0, contactedLeads: 0, salesAgents: 0 };

test("a new user is pointed at connecting LinkedIn first", () => {
  const { next, steps } = buildSalesGuidance(empty);
  assert.equal(next.id, "linkedin");
  assert.ok(steps.every((s) => !s.done));
});

test("optional steps never become the next step", () => {
  const counts = { ...empty, linkedinAccounts: 1, campaigns: 1, leads: 3, researchedLeads: 3, messages: 3, contactedLeads: 1 };
  const { next, steps } = buildSalesGuidance(counts, { indeedReady: false });
  assert.equal(next, null);
  assert.equal(steps.find((s) => s.id === "job-boards").done, false);
  assert.equal(steps.find((s) => s.id === "agent").done, false);
});

test("the first unfinished required step is next", () => {
  const { next } = buildSalesGuidance({ ...empty, linkedinAccounts: 1, campaigns: 2 });
  assert.equal(next.id, "leads");
});

test("job boards are done only when Indeed is set up and Rozee is connected", () => {
  const step = (opts, rozee) => buildSalesGuidance({ ...empty, rozeeAccounts: rozee }, opts).steps.find((s) => s.id === "job-boards");
  assert.equal(step({ indeedReady: true }, 1).done, true);
  assert.equal(step({ indeedReady: true }, 0).done, false);
  assert.equal(step({ indeedReady: false }, 1).done, false);
});
