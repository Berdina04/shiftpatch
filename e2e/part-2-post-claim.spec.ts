import { expect, test } from "@playwright/test";
import { logIn, resetDb } from "./support/helpers";

test.beforeAll(resetDb);

test("an agency posts a shift and Maria claims it; a stale tab gets 'already taken' and drops the row", async ({
  browser,
}) => {
  // Sunrise Health Staffing posts a shift.
  const agency = await (await browser.newContext()).newPage();
  await logIn(agency, "admin@sunrisehealth.example", /\/agency$/);
  await agency.getByTestId("agency-post-shift-button").click();
  await agency.getByLabel("Role").selectOption("RN");
  await agency.getByLabel("Date").fill("2026-12-01");
  await agency.getByLabel("Start time").fill("07:00");
  await agency.getByLabel("End time").fill("19:00");
  await agency.getByTestId("agency-post-shift-submit-button").click();
  await expect(agency.getByTestId("notification-banner")).toHaveText("Shift posted");
  const posted = agency.locator('[data-shift-id="shift-4"]');
  await expect(posted).toContainText("2026-12-01 · 07:00–19:00");
  await expect(posted).toContainText("Open");

  // Maria has the open list in two tabs.
  const maria = await browser.newContext();
  const tab1 = await maria.newPage();
  await logIn(tab1, "maria.lopez@example.com", /\/shifts$/);
  const tab2 = await maria.newPage();
  // Tab 2's timers are frozen once loaded, so its 10 s poll can never run:
  // only the refresh after the 409 can update its list.
  const start = Date.now();
  await tab2.clock.install({ time: start });
  await tab2.goto("/shifts");
  const row = (page: typeof tab1) => page.locator('[data-testid="shift-list-item"][data-shift-id="shift-4"]');
  await expect(row(tab1)).toBeVisible();
  await expect(row(tab2)).toBeVisible();
  await tab2.clock.pauseAt(start + 5_000);

  // Tab 1 claims it.
  await row(tab1).getByTestId("shift-claim-button").click();
  await expect(tab1.getByTestId("notification-banner")).toHaveText("Shift claimed");
  await expect(row(tab1)).toHaveCount(0);

  // Tab 2 still shows it, clicks claim, gets "already taken", and the row goes.
  await expect(row(tab2)).toBeVisible();
  await row(tab2).getByTestId("shift-claim-button").click();
  await expect(tab2.getByTestId("notification-banner")).toHaveText("Shift already taken");
  await expect(row(tab2)).toHaveCount(0);
  // The other open shifts are still listed.
  await expect(tab2.getByTestId("shift-list-item")).toHaveCount(2);

  // The agency sees the shift filled by Maria.
  await agency.reload();
  await expect(agency.locator('[data-shift-id="shift-4"]')).toContainText("Filled · nurse-1");
});

test("James's expired credential shows the spec's error in the banner", async ({ page }) => {
  await logIn(page, "james.cook@example.com", /\/shifts$/);
  await page.locator('[data-shift-id="shift-1"]').getByTestId("shift-claim-button").click();
  await expect(page.getByTestId("notification-banner")).toHaveText("Credential expired, cannot claim shift");
  // A 403 isn't a stale list: the shift stays.
  await expect(page.locator('[data-testid="shift-list-item"][data-shift-id="shift-1"]')).toBeVisible();
});

test("the admin sees the open list without claim buttons", async ({ page }) => {
  await logIn(page, "alex.kim@example.com", /\/shifts$/);
  await expect(page.getByTestId("shift-list-item")).toHaveCount(2);
  await expect(page.getByTestId("shift-claim-button")).toHaveCount(0);
});
