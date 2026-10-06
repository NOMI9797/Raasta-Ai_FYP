import { expect, test, type Page } from "@playwright/test";

const forbiddenCopy = [
  "rea" + "chly",
  "Pay" + " once",
  "Save hours" + " of repetitive code",
  "FYP",
  "TODO",
];

async function openLanding(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

test("loads without browser console errors or failed network requests", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ${request.failure()?.errorText ?? "unknown error"}`);
  });

  await openLanding(page);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  expect(failedRequests, failedRequests.join("\n")).toEqual([]);
});

test("has no horizontal scroll", async ({ page }) => {
  await openLanding(page);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
});

test("contains none of the forbidden legacy or placeholder copy", async ({ page }) => {
  await openLanding(page);
  const renderedText = await page.locator("body").innerText();
  for (const phrase of forbiddenCopy) {
    expect(renderedText.toLowerCase(), `Found forbidden text: ${phrase}`).not.toContain(phrase.toLowerCase());
  }
});

test("navbar links scroll to their sections", async ({ page }) => {
  await openLanding(page);
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  for (const target of ["features", "workflow", "pricing", "faq"]) {
    if (mobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.locator(`[data-testid="nav-${target}"]:visible`).click();
    await expect(page.locator(`#${target}`)).toBeInViewport();
  }
});

test("hero content and pricing cards are visible", async ({ page }) => {
  await openLanding(page);
  await expect(page.getByTestId("hero-heading")).toBeVisible();
  await expect(page.getByTestId("hero-primary-cta")).toBeVisible();
  await expect(page.getByTestId("hero-secondary-cta")).toBeVisible();
  await expect(page.getByTestId("pricing-card")).toHaveCount(2);
  for (const card of await page.getByTestId("pricing-card").all()) {
    await expect(card).toBeVisible();
  }
});

test("solution tabs switch their panel content", async ({ page }) => {
  await openLanding(page);
  const panel = page.getByTestId("solution-panel");
  await page.getByTestId("solution-tab-campaign-management").click();
  await expect(panel).toContainText("Campaign Management");
  await page.getByTestId("solution-tab-recruiter-pipeline").click();
  await expect(panel).toContainText("Recruiter Pipeline");
});

test("workflow tabs switch their panel content", async ({ page }) => {
  await openLanding(page);
  const panel = page.getByTestId("workflow-panel");
  await page.getByTestId("workflow-tab-outreach").click();
  await expect(panel).toContainText("Lead CSV");
  await page.getByTestId("workflow-tab-hiring").click();
  await expect(panel).toContainText("Job preferences");
});

test("get started buttons open signup with sign-in available", async ({ page }) => {
  await openLanding(page);
  await page.getByTestId("final-get-started").click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/signup$/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  await openLanding(page);
  await page.getByTestId("pricing-get-started").first().click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/signup$/, { timeout: 20_000 });
});

test("final CTA buttons are visible", async ({ page }) => {
  await openLanding(page);
  const cta = page.getByTestId("section-final-cta");
  await expect(cta.getByRole("button", { name: "Get Started Free" })).toBeVisible();
  await expect(cta.getByRole("button", { name: "Book a Demo" })).toBeVisible();
});

test("FAQ accordion keeps only one item open", async ({ page }) => {
  await openLanding(page);
  const items = page.getByTestId("faq-item");
  expect(await items.count()).toBeGreaterThan(1);
  await expect(items.nth(0).getByRole("button")).toHaveAttribute("aria-expanded", "true");
  await items.nth(1).getByRole("button").click();
  await expect(items.nth(0).getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await expect(items.nth(1).getByRole("button")).toHaveAttribute("aria-expanded", "true");
});

test("cumulative layout shift stays below 0.05", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __cls?: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
        if (!entry.hadRecentInput) (window as typeof window & { __cls?: number }).__cls = ((window as typeof window & { __cls?: number }).__cls ?? 0) + entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await openLanding(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  const cls = await page.evaluate(() => (window as typeof window & { __cls?: number }).__cls ?? 0);
  expect(cls).toBeLessThan(0.05);
});

for (const section of ["hero", "problem", "features", "solution", "workflow", "built-for", "resources", "pricing", "faq", "final-cta", "footer"]) {
  test(`visual snapshot: ${section}`, async ({ page }, testInfo) => {
    await openLanding(page);
    const locator = page.getByTestId(`section-${section}`);
    await expect(locator).toBeVisible();
    await expect(locator).toHaveScreenshot(`${section}-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  });
}



