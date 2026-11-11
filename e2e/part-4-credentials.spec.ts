import { expect, test, type Page } from "@playwright/test";
import { LICENCE_PNG, onePagePdf } from "./support/files";
import { freezeTimers, logIn, resetDb } from "./support/helpers";

test.beforeEach(resetDb);

const PDF = onePagePdf("Test licence");

/** Uploads a file with the nurse's form and waits for the success banner. */
async function uploadWithForm(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, expiresOn: string) {
  await page.getByTestId("credential-upload-input").setInputFiles(file);
  await page.getByTestId("credential-expiry-date-input").fill(expiresOn);
  await page.getByRole("button", { name: "Upload credential" }).click();
  await expect(page.getByTestId("notification-banner")).toHaveText("Credential uploaded, pending admin review");
}

test("James uploads a credential, is still blocked, the admin approves it, and James claims a shift", async ({
  browser,
}) => {
  const james = await (await browser.newContext()).newPage();
  await logIn(james, "james.cook@example.com", /\/shifts$/);
  const banner = james.getByTestId("notification-banner");
  const claimShift3 = james.locator('[data-testid="shift-list-item"][data-shift-id="shift-3"]').getByTestId("shift-claim-button");

  // James uploads a new licence.
  await uploadWithForm(james, { name: "james-licence.pdf", mimeType: "application/pdf", buffer: PDF }, "2028-01-01");
  const upload = james.locator("[data-credential-id]", { hasText: "james-licence.pdf" });
  await expect(upload).toContainText("Pending review");
  await expect(upload).toContainText("Expires 2028-01-01");

  // Still blocked: the new credential is pending, his approved one has expired.
  await claimShift3.click();
  await expect(banner).toHaveText("Credential expired, cannot claim shift");

  // The admin finds it in the review queue and approves it.
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

test("the admin opens each upload from the review queue and the browser shows it", async ({ browser }) => {
  // Review of Part 4, finding 3: click the real link and check what the new tab shows.
  const james = await (await browser.newContext()).newPage();
  await logIn(james, "james.cook@example.com", /\/shifts$/);
  await uploadWithForm(james, { name: "licence-scan.png", mimeType: "image/png", buffer: LICENCE_PNG.buffer }, "2029-01-01");
  await uploadWithForm(james, { name: "licence.pdf", mimeType: "application/pdf", buffer: PDF }, "2028-01-01");

  const admin = await (await browser.newContext()).newPage();
  await logIn(admin, "alex.kim@example.com", /\/admin$/);
  async function openFromQueue(fileName: string): Promise<Page> {
    const link = admin.locator("tr[data-credential-id]", { hasText: fileName }).getByRole("link", { name: "Open file" });
    const [tab] = await Promise.all([admin.waitForEvent("popup"), link.click()]);
    await tab.waitForLoadState();
    return tab;
  }

  // The PNG is drawn at its real size.
  const image = await openFromQueue("licence-scan.png");
  await expect
    .poll(() =>
      image.evaluate(() => {
        const img = document.images[0];
        return img?.complete ? [img.naturalWidth, img.naturalHeight] : null;
      }),
    )
    .toStrictEqual([LICENCE_PNG.width, LICENCE_PNG.height]);

  // The PDF opens in Chrome's PDF viewer (this project runs full Chromium, which has one).
  const pdf = await openFromQueue("licence.pdf");
  await expect.poll(() => pdf.frames().some((f) => f.url().startsWith("chrome-extension://"))).toBe(true);
});

test("an agency sees credential statuses but can't open a file", async ({ browser }) => {
  // James uploads, so there is a file to try.
  const james = await (await browser.newContext()).newPage();
  await logIn(james, "james.cook@example.com", /\/shifts$/);
  await uploadWithForm(james, { name: "james-licence.pdf", mimeType: "application/pdf", buffer: PDF }, "2028-01-01");
  const href = await james
    .locator("[data-credential-id]", { hasText: "james-licence.pdf" })
    .getByRole("link", { name: "Open file" })
    .getAttribute("href");

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

test("an upload that a poll brought in before its response arrived is listed once", async ({ page }) => {
  // Review of Part 4, finding 1. The page's clock is controlled, so the test
  // runs the 10 s poll while the upload's response is held back.
  await page.clock.install();
  await logIn(page, "james.cook@example.com", /\/shifts$/);
  await freezeTimers(page);

  let committed!: () => void;
  const uploadCommitted = new Promise<void>((resolve) => (committed = resolve));
  let release!: () => void;
  const responseReleased = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/credentials", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); // the server has saved the upload
    committed();
    await responseReleased;
    await route.fulfill({ response });
  });

  await page.getByTestId("credential-upload-input").setInputFiles({ name: "james-licence.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByTestId("credential-expiry-date-input").fill("2028-01-01");
  await page.getByRole("button", { name: "Upload credential" }).click();
  await uploadCommitted;

  const rows = page.locator("[data-credential-id]", { hasText: "james-licence.pdf" });
  await page.clock.runFor(10_000); // the poll brings the new credential in
  await expect(rows).toHaveCount(1);

  release();
  await expect(page.getByTestId("notification-banner")).toHaveText("Credential uploaded, pending admin review");
  await expect(rows).toHaveCount(1);
});

test("expiry labels follow the server's date on each poll, without a reload", async ({ browser }) => {
  // Review of Part 4, finding 2. The test server's clock is pinned to
  // 2026-11-10 for the whole run, so the poll's response is rewritten to say
  // the server's date is now 2027-01-01, the day Maria's credential expires.
  for (const [email, landsOn] of [
    ["maria.lopez@example.com", /\/shifts$/],
    ["admin@sunrisehealth.example", /\/agency$/],
  ] as const) {
    const page = await (await browser.newContext()).newPage();
    await page.clock.install();
    await logIn(page, email, landsOn);
    const maria = page.locator('[data-credential-id="cred-nurse-1"]');
    await expect(maria).toContainText("Approved");
    await freezeTimers(page);

    await page.route("**/api/credentials", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), today: "2027-01-01" } });
    });
    await page.clock.runFor(10_000);
    await expect(maria).toContainText("Expired");
  }
});
