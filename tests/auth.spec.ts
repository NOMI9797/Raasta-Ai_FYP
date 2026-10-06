import { expect, test } from "@playwright/test";

test.describe("authentication forms", () => {
  test("signup shows inline validation messages on blur", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("First name").focus();
    await page.getByLabel("Last name").focus();
    await expect(page.getByText("First name is required")).toBeVisible();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).focus();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").focus();
    await expect(page.getByText("Password does not meet all requirements")).toBeVisible();
  });

  test("password rules and strength meter update live", async ({ page }) => {
    await page.goto("/signup");
    const password = page.getByLabel("Password", { exact: true });
    const meter = page.getByLabel("Password strength");
    await expect(meter.locator(".bg-emerald-500")).toHaveCount(0);
    await password.fill("longpassword");
    await expect(meter.locator(".bg-emerald-500")).toHaveCount(1);
    await password.fill("Longpassword");
    await expect(meter.locator(".bg-emerald-500")).toHaveCount(2);
    await password.fill("Longpassword1");
    await expect(meter.locator(".bg-emerald-500")).toHaveCount(3);
    await expect(page.getByText("At least 8 characters")).toHaveClass(/text-emerald-700/);
    await expect(page.getByText("One uppercase letter")).toHaveClass(/text-emerald-700/);
    await expect(page.getByText("One number")).toHaveClass(/text-emerald-700/);
  });

  test("navigates between signup and login", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });

  test("login validates required credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
    await expect(page.getByText("Please correct the highlighted fields", { exact: true })).toBeVisible();
  });
});
