import { expect, test } from "@playwright/test";
import { logIn, resetDb } from "./support/helpers";

test.beforeEach(resetDb);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

test("James uploads a credential, is still blocked, the admin approves it, and James claims a shift", async ({
  browser,
}) => {
  const james = await (await browser.newContext()).newPage();
  await logIn(james, "james.cook@example.com", /\/shifts$/);
  const banner = james.getByTestId("notification-banner");
  const claimShift3 = james.locator('[data-testid="shift-list-item"][data-shift-id="shift-3"]').getByTestId("shift-claim-button");

  // James uploads a new licence.
  await james.getByTestId("credential-upload-input").setInputFiles({ name: "james-licence.pdf", mimeType: "application/pdf", buffer: PDF });
  await james.getByTestId("credential-expiry-date-input").fill("2028-01-01");
  await james.getByRole("button", { name: "Upload credential" }).click();
  await expect(banner).toHaveText("Credential uploaded, pending admin review");
  const upload = james.locator("[data-credential-id]", { hasText: "james-licence.pdf" });
  await expect(upload).toContainText("Pending review");
  await expect(upload).toContainText("Expires 2028-01-01");

  // Still blocked: the new credential is pending, his approved one has expired.
  await claimShift3.click();
  await expect(banner).toHaveText("Credential expired, cannot claim shift");

  // The admin opens the file from the review queue and approves it.
  const admin = await (await browser.newContext()).newPage();
  await logIn(admin, "alex.kim@example.com", /\/admin$/);
  const row = admin.locator("tr[data-credential-id]", { hasText: "James Cook (nurse-2)" });
  await expect(row).toContainText("2028-01-01");
  await expect(row).toContainText("james-licence.pdf");
  const href = await row.getByRole("link", { name: "Open file" }).getAttribute("href");
  const file = await admin.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(Buffer.compare(await file.body(), PDF)).toBe(0);
  // James can open his own file too.
  expect((await james.request.get(href!)).status()).toBe(200);

  await row.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByTestId("notification-banner")).toHaveText("Credential approved");
  await expect(row).toHaveCount(0);
  await expect(admin.getByTestId("audit-log-table")).toContainText("credential.approved");

  // James claims shift-3 now.
  await claimShift3.click();
  await expect(banner).toHaveText("Shift claimed");
  await expect(james.locator('[data-my-shift-id="shift-3"]')).toBeVisible();
  await james.reload();
  await expect(james.locator("[data-credential-id]", { hasText: "james-licence.pdf" })).toContainText("Approved");
});

test("an agency sees credential statuses but can't open a file", async ({ browser }) => {
  // James uploads, so there is a file to try.
  const james = await (await browser.newContext()).newPage();
  await logIn(james, "james.cook@example.com", /\/shifts$/);
  await james.getByTestId("credential-upload-input").setInputFiles({ name: "james-licence.pdf", mimeType: "application/pdf", buffer: PDF });
  await james.getByTestId("credential-expiry-date-input").fill("2028-01-01");
  await james.getByRole("button", { name: "Upload credential" }).click();
  await expect(james.getByTestId("notification-banner")).toHaveText("Credential uploaded, pending admin review");
  const href = await james.locator("[data-credential-id]", { hasText: "james-licence.pdf" }).getByRole("link", { name: "Open file" }).getAttribute("href");

  const agency = await (await browser.newContext()).newPage();
  await logIn(agency, "admin@sunrisehealth.example", /\/agency$/);
  const pending = agency.locator("tr[data-credential-id]", { hasText: "2028-01-01" });
  await expect(pending).toContainText("James Cook (nurse-2)");
  await expect(pending).toContainText("Pending review");
  await expect(agency.locator("tr[data-credential-id]", { hasText: "2026-06-01" })).toContainText("Expired");
  await expect(agency.getByRole("link", { name: "Open file" })).toHaveCount(0);
  expect((await agency.request.get(href!)).status()).toBe(403);
});

test("a file over 4 MB is refused in the form, before anything is uploaded", async ({ page }) => {
  await logIn(page, "james.cook@example.com", /\/shifts$/);
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/credentials") uploads.push(r.url());
  });

  const big = Buffer.alloc(4 * 1024 * 1024 + 1);
  PDF.copy(big);
  await page.getByTestId("credential-upload-input").setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: big });
  await expect(page.getByTestId("notification-banner")).toHaveText("File must be 4 MB or smaller");
  await page.getByTestId("credential-expiry-date-input").fill("2028-01-01");
  await page.getByRole("button", { name: "Upload credential" }).click();
  await expect(page.getByTestId("notification-banner")).toHaveText("File must be 4 MB or smaller");

  expect(uploads).toStrictEqual([]);
  await expect(page.locator("[data-credential-id]")).toHaveCount(1); // the seeded one
});
