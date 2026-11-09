import { expect, test } from "@playwright/test";

test("Maria logs in and sees the open shifts", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByTestId("login-email-input").fill("maria.lopez@example.com");
  await page.getByTestId("login-password-input").fill("Trial2026!");
  await page.getByTestId("login-submit-button").click();

  await expect(page).toHaveURL(/\/shifts$/);
  await expect(page.getByText("Maria Lopez")).toBeVisible();

  // Only open shifts: shift-1 and shift-3. shift-2 is filled.
  const items = page.getByTestId("shift-list-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute("data-shift-id", "shift-1");
  await expect(items.nth(0)).toContainText("RN");
  await expect(items.nth(0)).toContainText("Sunrise Health Staffing");
  await expect(items.nth(0)).toContainText("2026-10-02 · 19:00–07:00 (+1 day)");
  await expect(items.nth(1)).toHaveAttribute("data-shift-id", "shift-3");
  await expect(items.nth(1)).toContainText("Metro Care Partners");

  // The session survives a reload (httpOnly cookie).
  await page.reload();
  await expect(page.getByTestId("shift-list-item")).toHaveCount(2);
});
