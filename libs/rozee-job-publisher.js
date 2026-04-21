/**
 * Rozee.pk Job Publisher
 *
 * Publishes a job posting to Rozee.pk via Playwright. Requires an authenticated
 * page (e.g. from validateAndKeepOpen() in libs/rozee-session-validator.js).
 */

import { humanLikeDelay } from "./playwright-utils";

// ─── Selectors (TODO: validate against the recruiter "Post a Job" form) ───
export const ROZEE_POST_JOB_SELECTORS = {
  postJobNavUrl: "https://www.rozee.pk/employer/job/post",
  titleInput: "input[name='title'], input#title",
  descriptionInput: "textarea[name='description'], textarea#description",
  locationInput: "input[name='location'], input#location",
  salaryMinInput: "input[name='salary_min'], input#salary_min",
  salaryMaxInput: "input[name='salary_max'], input#salary_max",
  employmentTypeSelect: "select[name='employment_type']",
  submitButton: "button[type='submit'], input[type='submit']",
  publishedJobUrlIndicator: "/job/", // any URL containing /job/ after submit indicates published
};

/**
 * @param {import('playwright').Page} page – authenticated Rozee page
 * @param {Object} job – the jobs row from the database
 * @returns {Promise<{ success: boolean, postUrl?: string, error?: string }>}
 */
export async function publishRozeeJob(page, job) {
  if (!page) return { success: false, error: "page is required" };
  if (!job) return { success: false, error: "job is required" };

  try {
    await page.goto(ROZEE_POST_JOB_SELECTORS.postJobNavUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await humanLikeDelay(page, 1500, 2500);

    const fillIfPresent = async (selector, value) => {
      if (!value) return;
      try {
        const el = await page.$(selector);
        if (el) {
          await el.fill(String(value));
          await humanLikeDelay(page, 300, 700);
        }
      } catch {
        // selector not present — Rozee may have re-laid the form; skip silently
      }
    };

    await fillIfPresent(ROZEE_POST_JOB_SELECTORS.titleInput, job.title);
    await fillIfPresent(
      ROZEE_POST_JOB_SELECTORS.descriptionInput,
      job.rozeePost || job.linkedinPost || job.formalDescription || ""
    );
    await fillIfPresent(ROZEE_POST_JOB_SELECTORS.locationInput, job.location);
    await fillIfPresent(ROZEE_POST_JOB_SELECTORS.salaryMinInput, job.salaryMin);
    await fillIfPresent(ROZEE_POST_JOB_SELECTORS.salaryMaxInput, job.salaryMax);

    if (job.employmentType) {
      try {
        await page.selectOption(ROZEE_POST_JOB_SELECTORS.employmentTypeSelect, job.employmentType);
      } catch {
        // not selectable on current form layout — ignore
      }
    }

    await humanLikeDelay(page, 800, 1500);

    const submit = await page.$(ROZEE_POST_JOB_SELECTORS.submitButton);
    if (!submit) {
      return { success: false, error: "Submit button not found on Rozee post-a-job form" };
    }
    await submit.click();

    // Wait for navigation / confirmation
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await humanLikeDelay(page, 1500, 3000);

    const postUrl = page.url();
    const looksPublished = postUrl.includes(ROZEE_POST_JOB_SELECTORS.publishedJobUrlIndicator);

    return {
      success: looksPublished,
      postUrl: looksPublished ? postUrl : undefined,
      error: looksPublished ? undefined : "Submit did not navigate to a job URL",
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
