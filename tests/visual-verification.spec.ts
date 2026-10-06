import { expect, test } from "@playwright/test";
import path from "node:path";

for (const section of ["stats", "resources", "pricing"] as const) {
  test(`capture ${section}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "tablet");
    await page.goto("/");
    const locator = section === "stats"
      ? page.getByTestId("stat-cell").first().locator("xpath=..")
      : page.getByTestId(`section-${section}`);
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await expect(locator).toBeVisible();
    await locator.screenshot({
      animations: "disabled",
      path: path.join("artifacts", "verification", `${section}-${testInfo.project.name}.png`),
    });
  });
}
