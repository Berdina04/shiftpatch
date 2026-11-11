// Part 4: credential upload, listing, file access, admin review, and how
// claims treat pending, approved and rejected uploads (plan.md, "Verified by").
// Every role on every credential route: permissions.test.ts. Rollback and the
// review race: credential-guarantees.test.ts.
// The clock is pinned to 2026-11-10 (tests/support/pin-clock.mjs).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CREDENTIAL_ERRORS } from "@/lib/credentials";
import { db, resetToSeed } from "../support/db";
import { auditRows, createNurse } from "../support/fixtures";
import {
  claim,
  credentialFile,
  credentialForm,
  EMAILS,
  JPEG_BYTES,
  listCredentials,
  makeRequest,
  PDF_BYTES,
  pdfOfSize,
  PNG_BYTES,
  reviewCredential,
  reviewCredentialRaw,
  tokenFor,
  uploadCredential,
  uploadedCredentialId,
  uploadForm,
} from "../support/http";
import { POST as uploadRoute } from "@/app/api/credentials/route";

const E = CREDENTIAL_ERRORS;
const MB4 = 4 * 1024 * 1024;

let maria: string;
let james: string;
let agencyA: string;
let agencyB: string;
let alex: string;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  [maria, james, agencyA, agencyB, alex] = await Promise.all(
    [EMAILS.maria, EMAILS.james, EMAILS.agencyA, EMAILS.agencyB, EMAILS.alex].map((e) => tokenFor(e)),
  );
});
beforeEach(resetToSeed);

async function expectError(res: Response, status: number, error: string) {
  expect({ status: res.status, body: await res.json() }).toStrictEqual({ status, body: { error } });
}

/** Nothing beyond the seed: the two seeded credentials, no file, no audit entry. */
async function expectNothingWritten() {
  expect(await db().credential.count()).toBe(2);
  expect(await db().credentialFile.count()).toBe(0);
  expect(await db().auditLog.count()).toBe(0);
}

const MARIA_SEEDED = {
  id: "cred-nurse-1",
  nurseId: "nurse-1",
  nurseName: "Maria Lopez",
  expiresOn: "2027-01-01",
  status: "approved",
  createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  reviewedAt: null,
  rejectionReason: null,
  file: null,
};

describe("POST /api/credentials (upload)", () => {
  it("a nurse uploads a PDF: 201, pending, saved with its file in Postgres, audited", async () => {
    const res = await uploadCredential(james);
    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({
      id: "cred-1",
      nurseId: "nurse-2",
      nurseName: "James Cook",
      expiresOn: "2028-01-01",
      status: "pending",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      reviewedAt: null,
      rejectionReason: null,
      file: { fileName: "licence.pdf", contentType: "application/pdf", size: PDF_BYTES.length },
    });

    const file = await db().credentialFile.findUniqueOrThrow({ where: { credentialId: "cred-1" } });
    expect(Buffer.from(file.bytes).equals(Buffer.from(PDF_BYTES))).toBe(true);
    expect(await auditRows({ action: "credential.uploaded" })).toStrictEqual([
      {
        actorId: "nurse-2",
        actorRole: "nurse",
        action: "credential.uploaded",
        credentialId: "cred-1",
        details: {
          nurseId: "nurse-2",
          expiresOn: "2028-01-01",
          fileName: "licence.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
        },
      },
    ]);
  });

  it.each([
    ["PNG", PNG_BYTES, "image/png"],
    ["JPEG", JPEG_BYTES, "image/jpeg"],
  ] as const)("accepts a %s, typed by its bytes, not by the name or the type the browser sent", async (_n, bytes, type) => {
    const res = await uploadCredential(maria, { file: { bytes, name: "scan.bin", type: "application/octet-stream" } });
    expect(res.status).toBe(201);
    expect((await res.json()).file).toStrictEqual({ fileName: "scan.bin", contentType: type, size: bytes.length });
  });

  it("accepts a file of exactly 4 MB", async () => {
    const res = await uploadCredential(maria, { file: { bytes: pdfOfSize(MB4) } });
    expect(res.status).toBe(201);
    expect((await res.json()).file.size).toBe(MB4);
  });

  it("accepts an expiry date of tomorrow", async () => {
    expect((await uploadCredential(maria, { expiresOn: "2026-11-11" })).status).toBe(201);
  });

  describe("bad file type or size, or a bad expiry date → 400, and nothing is written", () => {
    const textFile = { bytes: new TextEncoder().encode("not a licence"), name: "licence.pdf", type: "application/pdf" };
    const gif = { bytes: new TextEncoder().encode("GIF89a\x01\x00\x01\x00"), name: "licence.gif", type: "image/gif" };
    const cases: [string, Parameters<typeof credentialForm>[0], string][] = [
      ["no file", { file: null }, E.fileRequired],
      ["file is text, not a file", { file: "licence.pdf" }, E.fileRequired],
      ["an empty file", { file: { bytes: new Uint8Array(0) } }, E.fileEmpty],
      ["4 MB + 1 byte", { file: { bytes: pdfOfSize(MB4 + 1) } }, E.fileTooLarge],
      ["a text file named .pdf, sent as application/pdf", { file: textFile }, E.fileType],
      ["a GIF", { file: gif }, E.fileType],
      ["no expiry date", { expiresOn: null }, E.badExpiry],
      ["2027-02-30", { expiresOn: "2027-02-30" }, E.badExpiry],
      ["01/01/2028", { expiresOn: "01/01/2028" }, E.badExpiry],
      ["today (the expiry date itself is not valid)", { expiresOn: "2026-11-10" }, E.expiryNotFuture],
      ["yesterday", { expiresOn: "2026-11-09" }, E.expiryNotFuture],
    ];
    it.each(cases)("%s", async (_name, fields, error) => {
      await expectError(await uploadCredential(maria, fields), 400, error);
      await expectNothingWritten();
    });

    it("a JSON body", async () => {
      const req = makeRequest("/api/credentials", { token: maria, body: { expiresOn: "2028-01-01" } });
      await expectError(await uploadRoute(req, {}), 400, E.notMultipart);
      await expectNothingWritten();
    });

    it("a body announced as larger than the limit is refused before it is read", async () => {
      const res = await uploadForm(maria, credentialForm(), { "content-length": String(MB4 + 65 * 1024) });
      await expectError(res, 400, E.fileTooLarge);
      await expectNothingWritten();
    });
  });

  it.each([
    ["agency-a", () => agencyA],
    ["agency-b", () => agencyB],
    ["the admin", () => alex],
  ])("%s can't upload (403) and nothing is written", async (_who, token) => {
    await expectError(await uploadCredential(token()), 403, E.nurseOnly);
    await expectNothingWritten();
  });
});

describe("GET /api/credentials", () => {
  it("a nurse sees only their own credentials", async () => {
    await uploadedCredentialId(james);
    const res = await listCredentials(maria);
    expect(res.status).toBe(200);
    // `today` is the server's UTC date (the pinned clock), for expiry labels.
    expect(await res.json()).toStrictEqual({ credentials: [MARIA_SEEDED], today: "2026-11-10" });

    const jamesList = (await (await listCredentials(james)).json()).credentials;
    expect(jamesList.map((c: { id: string; status: string }) => [c.id, c.status])).toStrictEqual([
      ["cred-nurse-2", "approved"],
      ["cred-1", "pending"],
    ]);
  });

  it("the admin sees everyone's; ?status=pending is the review queue", async () => {
    await uploadedCredentialId(james);
    const all = (await (await listCredentials(alex)).json()).credentials;
    expect(all.map((c: { id: string }) => c.id)).toStrictEqual(["cred-nurse-1", "cred-nurse-2", "cred-1"]);
    expect(all[2].file).toStrictEqual({ fileName: "licence.pdf", contentType: "application/pdf", size: PDF_BYTES.length });

    const queue = (await (await listCredentials(alex, "?status=pending")).json()).credentials;
    expect(queue.map((c: { id: string }) => c.id)).toStrictEqual(["cred-1"]);
  });

  it("an agency sees every nurse's status and expiry only: no file, no rejection reason", async () => {
    const id = await uploadedCredentialId(james);
    await reviewCredential(alex, id, { decision: "rejected", reason: "Photo is unreadable" });

    for (const token of [agencyA, agencyB]) {
      const res = await listCredentials(token);
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        credentials: [
          { id: "cred-nurse-1", nurseId: "nurse-1", nurseName: "Maria Lopez", expiresOn: "2027-01-01", status: "approved" },
          { id: "cred-nurse-2", nurseId: "nurse-2", nurseName: "James Cook", expiresOn: "2026-06-01", status: "approved" },
          { id: "cred-1", nurseId: "nurse-2", nurseName: "James Cook", expiresOn: "2028-01-01", status: "rejected" },
        ],
        today: "2026-11-10",
      });
    }
  });

  it("an unknown status filter is 400", async () => {
    await expectError(await listCredentials(alex, "?status=expired"), 400, E.badStatusFilter);
  });
});

describe("GET /api/credentials/:id/file", () => {
  let id: string;
  beforeEach(async () => {
    id = await uploadedCredentialId(james);
  });

  it.each([
    ["the nurse who uploaded it", () => james],
    ["the admin", () => alex],
  ])("%s gets the file, private and never cached", async (_who, token) => {
    const res = await credentialFile(token(), id);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PDF_BYTES))).toBe(true);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/pdf",
      "content-length": String(PDF_BYTES.length),
      "content-disposition": `inline; filename="licence.pdf"; filename*=UTF-8''licence.pdf`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    // The exact policy, so any change to it is deliberate. Playwright checks that Chrome still
    // shows the file (review of Part 4, finding 3).
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it.each([
    ["another nurse", () => maria],
    ["agency-a", () => agencyA],
    ["agency-b", () => agencyB],
  ])("%s gets 403", async (_who, token) => {
    await expectError(await credentialFile(token(), id), 403, E.fileForbidden);
  });

  describe("permission is checked before the file's existence (seeded credentials have no file)", () => {
    it.each([
      ["agency-a", () => agencyA],
      ["another nurse", () => james],
    ])("%s gets 403 for Maria's seeded credential", async (_who, token) => {
      await expectError(await credentialFile(token(), "cred-nurse-1"), 403, E.fileForbidden);
    });

    it.each([
      ["its nurse", () => maria],
      ["the admin", () => alex],
    ])("%s gets 404 'Credential has no file'", async (_who, token) => {
      await expectError(await credentialFile(token(), "cred-nurse-1"), 404, E.noFile);
    });
  });

  it("an unknown credential: 404 for a nurse or the admin, 403 for an agency", async () => {
    await expectError(await credentialFile(maria, "cred-999"), 404, E.notFound);
    await expectError(await credentialFile(alex, "cred-999"), 404, E.notFound);
    await expectError(await credentialFile(agencyA, "cred-999"), 403, E.fileForbidden);
  });
});

describe("POST /api/credentials/:id/review", () => {
  let id: string;
  beforeEach(async () => {
    id = await uploadedCredentialId(james);
  });

  async function stored() {
    const c = await db().credential.findUniqueOrThrow({ where: { id } });
    return { status: c.status, reviewedById: c.reviewedById, reviewed: c.reviewedAt !== null, rejectionReason: c.rejectionReason };
  }

  it("the admin approves: 200, approved, reviewer recorded, audited", async () => {
    const res = await reviewCredential(alex, id, { decision: "approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "approved", reviewedAt: expect.any(String), rejectionReason: null });
    expect(await stored()).toStrictEqual({ status: "approved", reviewedById: "admin-1", reviewed: true, rejectionReason: null });
    expect(await auditRows({ action: "credential.approved" })).toStrictEqual([
      {
        actorId: "admin-1",
        actorRole: "admin",
        action: "credential.approved",
        credentialId: id,
        details: { nurseId: "nurse-2", status: { from: "pending", to: "approved" } },
      },
    ]);
  });

  it("an approval ignores a reason", async () => {
    await reviewCredential(alex, id, { decision: "approved", reason: "looks fine" });
    expect((await stored()).rejectionReason).toBeNull();
  });

  it("the admin rejects with a reason: 200, rejected, the reason kept (trimmed), audited", async () => {
    const res = await reviewCredential(alex, id, { decision: "rejected", reason: "  Photo is unreadable " });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "rejected", rejectionReason: "Photo is unreadable" });
    expect(await stored()).toStrictEqual({
      status: "rejected",
      reviewedById: "admin-1",
      reviewed: true,
      rejectionReason: "Photo is unreadable",
    });
    expect((await auditRows({ action: "credential.rejected" }))[0].details).toStrictEqual({
      nurseId: "nurse-2",
      status: { from: "pending", to: "rejected" },
      reason: "Photo is unreadable",
    });
  });

  describe("bad requests → 400 and the credential stays pending", () => {
    const cases: [string, unknown, string][] = [
      ["no decision", {}, E.badDecision],
      ["an unknown decision", { decision: "maybe" }, E.badDecision],
      ["a rejection without a reason", { decision: "rejected" }, E.reasonRequired],
      ["a rejection with a blank reason", { decision: "rejected", reason: "   " }, E.reasonRequired],
      ["a reason over 500 characters", { decision: "rejected", reason: "x".repeat(501) }, E.reasonTooLong],
      ["a reason that isn't text", { decision: "rejected", reason: 42 }, E.badReason],
      ["not an object", ["approved"], "Request body must be a JSON object"],
    ];
    it.each(cases)("%s", async (_name, body, error) => {
      await expectError(await reviewCredential(alex, id, body), 400, error);
      expect(await stored()).toStrictEqual({ status: "pending", reviewedById: null, reviewed: false, rejectionReason: null });
      expect(await auditRows({ credentialId: id })).toHaveLength(1); // the upload only
    });

    it("a body that isn't JSON", async () => {
      await expectError(await reviewCredentialRaw(alex, id, "approve"), 400, "Request body must be valid JSON");
    });

    it("a 500-character reason is accepted", async () => {
      expect((await reviewCredential(alex, id, { decision: "rejected", reason: "x".repeat(500) })).status).toBe(200);
    });
  });

  it("a credential that was already reviewed is 409 and keeps its first review", async () => {
    await reviewCredential(alex, id, { decision: "approved" });
    await expectError(await reviewCredential(alex, id, { decision: "rejected", reason: "late" }), 409, E.alreadyReviewed);
    await expectError(await reviewCredential(alex, id, { decision: "approved" }), 409, E.alreadyReviewed);
    expect((await stored()).status).toBe("approved");
    expect(await auditRows({ credentialId: id })).toHaveLength(2); // upload + one approval
  });

  it("a seeded credential is already approved: 409", async () => {
    await expectError(await reviewCredential(alex, "cred-nurse-2", { decision: "rejected", reason: "x" }), 409, E.alreadyReviewed);
  });

  it("an unknown credential is 404", async () => {
    await expectError(await reviewCredential(alex, "cred-999", { decision: "approved" }), 404, E.notFound);
  });

  it.each([
    ["the nurse", () => james],
    ["an agency", () => agencyA],
  ])("%s can't review (403) and it stays pending", async (_who, token) => {
    await expectError(await reviewCredential(token(), id, { decision: "approved" }), 403, E.adminOnly);
    expect((await stored()).status).toBe("pending");
  });
});

describe("claims count only approved credentials", () => {
  it("a pending credential doesn't allow claims; approval does", async () => {
    const nurse = await createNurse([]); // no credential at all
    const id = await uploadedCredentialId(nurse.token);
    await expectError(await claim(nurse.token, "shift-3"), 403, "No approved credential, cannot claim shift");

    expect((await reviewCredential(alex, id, { decision: "approved" })).status).toBe(200);
    const res = await claim(nurse.token, "shift-3");
    expect(res.status).toBe(200);
    expect((await res.json()).claimedBy).toBe(nurse.id);
  });

  it("James uploads a new credential and is still blocked by his expired one until the admin approves", async () => {
    const id = await uploadedCredentialId(james);
    await expectError(await claim(james, "shift-3"), 403, "Credential expired, cannot claim shift");

    await reviewCredential(alex, id, { decision: "approved" });
    const res = await claim(james, "shift-3");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "shift-3", status: "filled", claimedBy: "nurse-2" });
  });

  it("a rejected credential doesn't allow claims", async () => {
    const nurse = await createNurse([]);
    const id = await uploadedCredentialId(nurse.token);
    await reviewCredential(alex, id, { decision: "rejected", reason: "Wrong document" });
    await expectError(await claim(nurse.token, "shift-3"), 403, "No approved credential, cannot claim shift");
  });

  it("an approved upload still has to cover the shift: one expiring before the shift ends doesn't count", async () => {
    const nurse = await createNurse([]);
    // shift-3 is 2026-10-04 19:00 → 07:00, but the claim also needs it valid today (2026-11-10).
    const id = await uploadedCredentialId(nurse.token, "2026-11-11");
    await reviewCredential(alex, id, { decision: "approved" });
    expect((await claim(nurse.token, "shift-3")).status).toBe(200);

    const late = await db().shift.create({
      data: { agencyId: "agency-a", role: "RN", date: new Date("2026-11-10T00:00:00Z"), startTime: "19:00", endTime: "07:00" },
    });
    await expectError(await claim(nurse.token, late.id), 403, "Credential expired, cannot claim shift");
  });
});
