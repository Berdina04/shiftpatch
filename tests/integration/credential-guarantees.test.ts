// Part 4 guarantees on real Postgres (plan.md, "Verified by"):
//  - a failed upload changes nothing: the credential row, its file and the
//    audit entry are written in one transaction;
//  - a failed review changes nothing;
//  - two reviews of one credential can't both succeed.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { auditRows } from "../support/fixtures";
import { EMAILS, reviewCredential, tokenFor, uploadCredential, uploadedCredentialId } from "../support/http";

let james: string;
let alex: string;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  james = await tokenFor(EMAILS.james);
  alex = await tokenFor(EMAILS.alex);
});
beforeEach(resetToSeed);

/** A temporary trigger that makes every insert into `table` raise. No test hook in the app code. */
function failInsertsInto(table: "AuditLog" | "CredentialFile") {
  beforeEach(async () => {
    await db().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced insert failure (test)'; END;
      $$ LANGUAGE plpgsql`);
    await db().$executeRawUnsafe(`
      CREATE TRIGGER test_fail_insert BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION test_fail_insert()`);
  });
  afterEach(async () => {
    await db().$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_insert ON "${table}"`);
    await db().$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_insert()");
  });
}

async function expect500(res: Response) {
  expect({ status: res.status, body: await res.json() }).toStrictEqual({
    status: 500,
    body: { error: "Internal server error" },
  });
}

describe("rollback: the file insert fails", () => {
  failInsertsInto("CredentialFile");

  it("an upload returns 500 and no credential is saved", async () => {
    await expect500(await uploadCredential(james));
    expect(await db().credential.count()).toBe(2); // the seed's
    expect(await db().credentialFile.count()).toBe(0);
    expect(await db().auditLog.count()).toBe(0);
  });
});

describe("rollback: the audit insert fails", () => {
  it("an upload returns 500 and neither the credential nor its file is saved", async () => {
    await withFailingAudit(async () => {
      await expect500(await uploadCredential(james));
    });
    expect(await db().credential.count()).toBe(2);
    expect(await db().credentialFile.count()).toBe(0);
    expect(await db().auditLog.count()).toBe(0);
  });

  it("a review returns 500 and the credential stays pending, with no reviewer", async () => {
    const id = await uploadedCredentialId(james); // before the trigger exists
    await withFailingAudit(async () => {
      await expect500(await reviewCredential(alex, id, { decision: "approved" }));
      await expect500(await reviewCredential(alex, id, { decision: "rejected", reason: "x" }));
    });
    const c = await db().credential.findUniqueOrThrow({ where: { id } });
    expect([c.status, c.reviewedById, c.reviewedAt, c.rejectionReason]).toStrictEqual(["pending", null, null, null]);
    expect(await auditRows({ credentialId: id })).toHaveLength(1); // the upload only
  });
});

async function withFailingAudit(fn: () => Promise<void>) {
  await db().$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'forced audit failure (test)'; END;
    $$ LANGUAGE plpgsql`);
  await db().$executeRawUnsafe(`
    CREATE TRIGGER test_fail_audit BEFORE INSERT ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION test_fail_audit()`);
  try {
    await fn();
  } finally {
    await db().$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_audit ON "AuditLog"');
    await db().$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_audit()");
  }
}

describe("race: ten reviews of one credential at once", () => {
  it.each(Array.from({ length: 5 }, (_, i) => i + 1))(
    "round %i: exactly one 200, nine 409, one review stored and audited",
    async () => {
      const id = await uploadedCredentialId(james);
      const bodies = Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0 ? { decision: "approved" } : { decision: "rejected", reason: `reason ${i}` },
      );

      const responses = await Promise.all(bodies.map((b) => reviewCredential(alex, id, b)));
      const results = await Promise.all(responses.map(async (r, i) => ({ i, status: r.status, body: await r.json() })));

      const winners = results.filter((r) => r.status === 200);
      expect(winners).toHaveLength(1);
      for (const l of results.filter((r) => r.status !== 200)) {
        expect([l.status, l.body]).toStrictEqual([409, { error: "Credential already reviewed" }]);
      }

      const won = bodies[winners[0].i] as { decision: string; reason?: string };
      const c = await db().credential.findUniqueOrThrow({ where: { id } });
      expect([c.status, c.rejectionReason]).toStrictEqual([won.decision, won.reason ?? null]);
      const reviews = (await auditRows({ credentialId: id })).filter((a) => a.action !== "credential.uploaded");
      expect(reviews.map((a) => a.action)).toStrictEqual([`credential.${won.decision}`]);
    },
  );
});
