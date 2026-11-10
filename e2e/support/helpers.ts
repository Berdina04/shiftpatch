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
