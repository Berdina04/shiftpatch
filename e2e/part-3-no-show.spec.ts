import { expect, test } from "@playwright/test";
import { freezeTimers, logIn, resetDb } from "./support/helpers";

test.beforeEach(resetDb);

test("an agency marks a no-show; the admin's dashboard shows the shift open with 'reopened (no-show)' and the audit entry", async ({
  browser,
}) => {
  // The admin's dashboard is already open. Its clock is controlled, so the
  // test runs the 10 s poll on demand: no reload, no waiting.
  const admin = await (await browser.newContext()).newPage();
  await admin.clock.install();
  await logIn(admin, "alex.kim@example.com", /\/admin$/);
  const adminRow = admin.getByTestId("admin-dashboard-shift-table").locator('tr[data-shift-id="shift-2"]');
  const badge = adminRow.getByTestId("admin-shift-status-badge");
  await expect(badge).toHaveText("filled");
  await expect(adminRow).toContainText("Maria Lopez (nurse-1)");
  await expect(adminRow).not.toContainText("reopened");
  // The admin's reopen control has no reason preselected either.
  await expect(adminRow.getByLabel("Reason")).toHaveValue("");
  await expect(adminRow.getByTestId("shift-cancel-button")).toBeDisabled();
  await expect(admin.getByTestId("audit-log-table")).not.toContainText("shift.cancelled");
  await freezeTimers(admin);

  // Sunrise Health Staffing marks Maria's shift-2 as a no-show.
  const agency = await (await browser.newContext()).newPage();
  await logIn(agency, "admin@sunrisehealth.example", /\/agency$/);
  const agencyRow = agency.locator('[data-shift-id="shift-2"]');
  await expect(agencyRow).toContainText("Filled · nurse-1");
  // No reason is preselected: the button stays disabled until one is picked.
  const reason = agencyRow.getByLabel("Reason");
  const cancelButton = agencyRow.getByTestId("shift-cancel-button");
  await expect(reason).toHaveValue("");
  await expect(cancelButton).toBeDisabled();
  await reason.selectOption("no-show");
  await expect(cancelButton).toBeEnabled();
  await cancelButton.click();
  await expect(agency.getByTestId("notification-banner")).toHaveText("Shift reopened (no-show)");
  await expect(agencyRow).toContainText("Open");
  await expect(agencyRow.getByTestId("shift-cancel-button")).toHaveCount(0);

  // The admin's next poll shows it: open, the marker, and the audit entry.
  await expect(badge).toHaveText("filled");
  await admin.clock.runFor(10_000);
  await expect(badge).toHaveText("open");
  await expect(adminRow).toContainText("reopened (no-show)");
  await expect(adminRow.getByTestId("shift-cancel-button")).toHaveCount(0);
  const entry = admin.getByTestId("audit-log-table").locator("tbody tr", { hasText: "shift.cancelled" });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("agency-a (agency)");
  await expect(entry).toContainText("shift-2");
  await expect(entry).toContainText("no-show · previous nurse nurse-1");
});

test("Maria cancels her shift in advance from 'My shifts'; it is back on the open list", async ({ page }) => {
  await logIn(page, "maria.lopez@example.com", /\/shifts$/);
  const mine = page.locator('[data-my-shift-id="shift-2"]');
  await expect(mine).toContainText("LPN · Sunrise Health Staffing");
  // Nurses only cancel in advance, so there is no reason to pick.
  await expect(mine.getByLabel("Reason")).toHaveCount(0);

  await mine.getByTestId("shift-cancel-button").click();

  await expect(page.getByTestId("notification-banner")).toHaveText("Shift cancelled");
  await expect(mine).toHaveCount(0);
  await expect(page.locator('[data-testid="shift-list-item"][data-shift-id="shift-2"]')).toBeVisible();
  await expect(page.getByTestId("shift-list-item")).toHaveCount(3);
});
