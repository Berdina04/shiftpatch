import { expect, test } from "@playwright/test";
import { logIn, resetDb } from "./support/helpers";

test.beforeEach(resetDb);

test("Maria sees 12 h for shift-2 on her timesheet, labelled as scheduled hours; the overnight shift-1 adds 12 h", async ({
  page,
}) => {
  await logIn(page, "maria.lopez@example.com", /\/shifts$/);
  await page.getByRole("link", { name: "Timesheets", exact: true }).click();
  await expect(page).toHaveURL(/\/timesheets$/);
  await expect(page.getByText("Scheduled hours — not actual time worked")).toBeVisible();

  const table = page.getByTestId("timesheet-table");
  const shift2 = table.locator('tr[data-shift-id="shift-2"]');
  await expect(shift2).toContainText("Maria Lopez (nurse-1)");
  await expect(shift2).toContainText("Sunrise Health Staffing");
  await expect(shift2).toContainText("2026-10-03 · 07:00–19:00");
  await expect(shift2.locator("td").last()).toHaveText("12 h");
  const total = table.locator('tr[data-total-for="nurse-1"]');
  await expect(total).toContainText("Total · Maria Lopez");
  await expect(total.locator("td").last()).toHaveText("12 h");
  // Her shifts only: the open shift-1 and shift-3 don't count.
  await expect(table.locator("tr[data-shift-id]")).toHaveCount(1);

  // She claims the overnight shift-1 (19:00–07:00), then reopens her timesheet.
  await page.getByRole("link", { name: "Shifts", exact: true }).click();
  await expect(page).toHaveURL(/\/shifts$/);
  await page.locator('[data-testid="shift-list-item"][data-shift-id="shift-1"]').getByTestId("shift-claim-button").click();
  await expect(page.getByTestId("notification-banner")).toHaveText("Shift claimed");
  await page.getByRole("link", { name: "Timesheets", exact: true }).click();
  await expect(page).toHaveURL(/\/timesheets$/);

  const shift1 = table.locator('tr[data-shift-id="shift-1"]');
  await expect(shift1).toContainText("2026-10-02 · 19:00–07:00 (+1 day)");
  await expect(shift1.locator("td").last()).toHaveText("12 h");
  await expect(table.locator("tr[data-shift-id]")).toHaveCount(2);
  await expect(total.locator("td").last()).toHaveText("24 h");
});

test("agency-a's timesheet counts only its own shifts: Maria's hours at agency-b don't show up there", async ({ browser }) => {
  // Maria also takes agency-b's shift-3.
  const maria = await (await browser.newContext()).newPage();
  await logIn(maria, "maria.lopez@example.com", /\/shifts$/);
  await maria.locator('[data-testid="shift-list-item"][data-shift-id="shift-3"]').getByTestId("shift-claim-button").click();
  await expect(maria.getByTestId("notification-banner")).toHaveText("Shift claimed");

  const agency = await (await browser.newContext()).newPage();
  await logIn(agency, "admin@sunrisehealth.example", /\/agency$/);
  await agency.getByRole("link", { name: "Timesheets", exact: true }).click();
  const table = agency.getByTestId("timesheet-table");
  await expect(table.locator("tr[data-shift-id]")).toHaveCount(1);
  await expect(table.locator('tr[data-shift-id="shift-2"]')).toBeVisible();
  await expect(table.locator('tr[data-total-for="nurse-1"] td').last()).toHaveText("12 h");

  // Maria's own timesheet has both.
  await maria.getByRole("link", { name: "Timesheets", exact: true }).click();
  await expect(maria.getByTestId("timesheet-table").locator('tr[data-total-for="nurse-1"] td').last()).toHaveText("24 h");
});
