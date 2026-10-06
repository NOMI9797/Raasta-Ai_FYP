import { expect, test } from "@playwright/test";

const publicRoutes = ["/", "/signin", "/login", "/signup", "/forgot-password", "/privacy-policy", "/tos", "/blog"];
const brokenEncoding = /\u00c3|\u00e2\u20ac|\u00c2|\ufffd/;

for (const route of publicRoutes) {
  test(`has clean UTF-8 text: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("body")).not.toContainText(brokenEncoding);
  });
}

test("stats count once and finish at the exact values", async ({ page }) => {
  await page.goto("/");
  const cells = page.getByTestId("stat-cell");
  await cells.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await expect(cells).toHaveCount(4);
  await expect(cells.nth(0).locator("strong")).toHaveText("15/day");
  await expect(cells.nth(1).locator("strong")).toHaveText("4\u20135");
  await expect(cells.nth(2).locator("strong")).toHaveText("4h");
  await expect(cells.nth(3).locator("strong")).toHaveText("2-in-1");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  await expect(cells.nth(0).locator("strong")).toHaveText("15/day");
});

test("completed reveals are fully opaque and unblurred", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1200);
  const unfinished = await page.locator("[style]").evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const hasRevealStyle = element.getAttribute("style")?.includes("opacity") || element.getAttribute("style")?.includes("filter");
    return hasRevealStyle && rect.bottom > 0 && rect.top < innerHeight && (style.opacity !== "1" || (style.filter !== "none" && style.filter !== "blur(0px)"));
  }).length);
  expect(unfinished).toBe(0);
});
