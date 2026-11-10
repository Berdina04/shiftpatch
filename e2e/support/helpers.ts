import { expect, type Page } from "@playwright/test";
import { createPrismaClient } from "../../lib/db";
import { resetDatabase } from "../../prisma/seed-data";
import { testDatabaseUrl } from "../../tests/support/test-env";

/** Restores trial-start data so each spec file starts from the seed. */
export async function resetDb(): Promise<void> {
  const db = createPrismaClient(testDatabaseUrl());
  try {
    await resetDatabase(db);
  } finally {
    await db.$disconnect();
  }
}

export async function logIn(page: Page, email: string, landsOn: RegExp): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill(email);
  await page.getByTestId("login-password-input").fill("Trial2026!");
  await page.getByTestId("login-submit-button").click();
  await expect(page).toHaveURL(landsOn);
}

/**
 * Stops the page's timers (its 10 s poll) from now on. The pause point is read
 * from the page's own clock, so it holds however long loading took. Call
 * `page.clock.install()` before the page loads; timers then run normally while
 * it loads.
 */
export async function freezeTimers(page: Page): Promise<void> {
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 1_000);
}
