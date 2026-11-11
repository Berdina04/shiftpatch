// Credentials with admin approval (docs/plan.md, Part 4).
//  - A nurse uploads a file and its expiry date. The credential row, its file
//    and the audit entry are written in one transaction, so a failed upload
//    changes nothing. It starts `pending`; claims only count `approved` ones
//    (lib/claims.ts).
//  - The admin approves or rejects (with a reason). The update only matches a
//    pending row, so two reviews of one credential can't both succeed.
//  - Only the owning nurse and the admin can open a file; agencies see the
//    status only. The file is never public: it is served by an authenticated
//    route, never cached.
import { z } from "zod";
import { WRITE_TX_OPTIONS, writeAudit } from "./audit";
import type { SessionUser } from "./auth";
import {
  CREDENTIAL_STATUSES,
  FILE_EMPTY,
  FILE_TOO_LARGE,
  MAX_CREDENTIAL_FILE_BYTES,
  REJECTION_REASON_MAX,
  type CredentialFileType,
  type CredentialStatus,
} from "./credential-rules";
import { getDb } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { HttpError } from "./http";
import { dateOnly, isCalendarDate, isoDate, startOfTodayUtc } from "./shift-time";

export const CREDENTIAL_ERRORS = {
  nurseOnly: "Only nurses can upload credentials",
  notMultipart: "Request body must be multipart/form-data",
  fileRequired: "file is required",
  fileEmpty: FILE_EMPTY,
  fileTooLarge: FILE_TOO_LARGE,
  fileType: "File must be a PDF, PNG or JPEG",
  badExpiry: "expiresOn must be a valid date (YYYY-MM-DD)",
  expiryNotFuture: "expiresOn must be after today",
  badStatusFilter: "status must be pending, approved or rejected",
  notFound: "Credential not found",
  noFile: "Credential has no file",
  fileForbidden: "Only the nurse who uploaded it and the admin can open this file",
  adminOnly: "Only the admin can review credentials",
  badDecision: "decision must be approved or rejected",
  badReason: "reason must be a string",
  reasonRequired: "reason is required to reject a credential",
  reasonTooLong: `reason must be ${REJECTION_REASON_MAX} characters or fewer`,
  alreadyReviewed: "Credential already reviewed",
} as const;

// --- Shapes ------------------------------------------------------------------

/** What the nurse (own credentials) and the admin (all) see. */
export type CredentialDto = {
  id: string;
  nurseId: string;
  nurseName: string;
  expiresOn: string;
  status: CredentialStatus;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  file: { fileName: string; contentType: string; size: number } | null; // null for seeded credentials
};

/** What an agency sees: the status only (plan.md). */
export type CredentialStatusDto = Pick<CredentialDto, "id" | "nurseId" | "nurseName" | "expiresOn" | "status">;

const credentialSelect = {
  id: true,
  nurseId: true,
  nurse: { select: { name: true } },
  expiresOn: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  rejectionReason: true,
  file: { select: { fileName: true, contentType: true, size: true } }, // never the bytes
} satisfies Prisma.CredentialSelect;

type CredentialRow = Prisma.CredentialGetPayload<{ select: typeof credentialSelect }>;

function toCredentialDto(row: CredentialRow): CredentialDto {
  return {
    id: row.id,
    nurseId: row.nurseId,
    nurseName: row.nurse.name,
    expiresOn: isoDate(row.expiresOn),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    file: row.file,
  };
}

function toStatusDto({ id, nurseId, nurseName, expiresOn, status }: CredentialDto): CredentialStatusDto {
  return { id, nurseId, nurseName, expiresOn, status };
}

// --- Upload ------------------------------------------------------------------

export type UploadInput = {
  fileName: string;
  contentType: CredentialFileType;
  bytes: Uint8Array<ArrayBuffer>;
  expiresOn: string;
};

// Room for the multipart boundaries and the expiresOn field around the file.
const MAX_UPLOAD_BODY_BYTES = MAX_CREDENTIAL_FILE_BYTES + 64 * 1024;

/**
 * The file's type from its first bytes, never from the name or the type the
 * browser sent, which the uploader controls.
 */
export function detectFileType(bytes: Uint8Array): CredentialFileType | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

/** A display name: no path, no control characters or quotes, at most 200 characters. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "_").trim().slice(0, 200);
  return cleaned || "credential";
}

/**
 * Validates a POST /api/credentials body: multipart/form-data with `file`
 * and `expiresOn`. Check order: body → file present → size → type → expiry.
 */
export async function parseUpload(req: Request): Promise<UploadInput> {
  if (!/^multipart\/form-data\b/i.test(req.headers.get("content-type") ?? "")) {
    throw new HttpError(400, CREDENTIAL_ERRORS.notMultipart);
  }
  // Refuse an oversized body before reading it (on Vercel it never gets here).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BODY_BYTES) {
    throw new HttpError(400, CREDENTIAL_ERRORS.fileTooLarge);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, CREDENTIAL_ERRORS.notMultipart);
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, CREDENTIAL_ERRORS.fileRequired);
  if (file.size === 0) throw new HttpError(400, CREDENTIAL_ERRORS.fileEmpty);
  if (file.size > MAX_CREDENTIAL_FILE_BYTES) throw new HttpError(400, CREDENTIAL_ERRORS.fileTooLarge);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectFileType(bytes);
  if (!contentType) throw new HttpError(400, CREDENTIAL_ERRORS.fileType);

  const expiresOn = form.get("expiresOn");
  if (typeof expiresOn !== "string" || !isCalendarDate(expiresOn)) {
    throw new HttpError(400, CREDENTIAL_ERRORS.badExpiry);
  }
  // An expired licence is no use; the expiry date itself is not valid (plan.md).
  if (dateOnly(expiresOn).getTime() <= startOfTodayUtc().getTime()) {
    throw new HttpError(400, CREDENTIAL_ERRORS.expiryNotFuture);
  }

  return { fileName: cleanFileName(file.name), contentType, bytes, expiresOn };
}

/** Saves a pending credential, its file and the audit entry in one transaction. */
export async function uploadCredential(nurse: SessionUser, input: UploadInput): Promise<CredentialDto> {
  const { fileName, contentType, bytes, expiresOn } = input;
  return getDb().$transaction(async (tx) => {
    const row = await tx.credential.create({
      data: {
        nurseId: nurse.id,
        expiresOn: dateOnly(expiresOn),
        file: { create: { fileName, contentType, size: bytes.byteLength, bytes } },
      },
      select: credentialSelect,
    });
    await writeAudit(tx, {
      actor: { id: nurse.id, role: nurse.role },
      action: "credential.uploaded",
      credentialId: row.id,
      details: { nurseId: nurse.id, expiresOn, fileName, contentType, size: bytes.byteLength },
    });
    return toCredentialDto(row);
  }, WRITE_TX_OPTIONS);
}

// --- List --------------------------------------------------------------------

/** `?status=` on GET /api/credentials; null when absent. */
export function parseStatusFilter(value: string | null): CredentialStatus | null {
  if (value === null) return null;
  if (!(CREDENTIAL_STATUSES as readonly string[]).includes(value)) {
    throw new HttpError(400, CREDENTIAL_ERRORS.badStatusFilter);
  }
  return value as CredentialStatus;
}

async function findCredentials(where: Prisma.CredentialWhereInput): Promise<CredentialDto[]> {
  const rows = await getDb().credential.findMany({
    where,
    select: credentialSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // oldest first: the review queue's order
  });
  return rows.map(toCredentialDto);
}

/** A nurse's own credentials. */
export const listNurseCredentials = (nurseId: string) => findCredentials({ nurseId });

/** The admin's review queue. */
export const listPendingCredentials = () => findCredentials({ status: "pending" });

/** What agencies see: every nurse's credentials, status only (plan.md). */
export async function listCredentialStatuses(status: CredentialStatus | null = null): Promise<CredentialStatusDto[]> {
  return (await findCredentials(status ? { status } : {})).map(toStatusDto);
}

/** GET /api/credentials. Nurse: own credentials. Admin: all. Agency: status only. */
export async function listCredentials(
  user: SessionUser,
  status: CredentialStatus | null = null,
): Promise<CredentialDto[] | CredentialStatusDto[]> {
  if (user.role === "agency") return listCredentialStatuses(status);
  return findCredentials({
    ...(status ? { status } : {}),
    ...(user.role === "nurse" ? { nurseId: user.id } : {}),
  });
}

// --- File --------------------------------------------------------------------

export type CredentialFileContent = { fileName: string; contentType: string; size: number; bytes: Uint8Array };

/**
 * The file, for the owning nurse or the admin. Permission comes before
 * existence: an agency or another nurse gets 403 even when the credential has
 * no file. Only then are the bytes read.
 */
export async function readCredentialFile(user: SessionUser, credentialId: string): Promise<CredentialFileContent> {
  if (user.role === "agency") throw new HttpError(403, CREDENTIAL_ERRORS.fileForbidden);

  const credential = await getDb().credential.findUnique({
    where: { id: credentialId },
    select: { nurseId: true, file: { select: { fileName: true, contentType: true, size: true } } },
  });
  if (!credential) throw new HttpError(404, CREDENTIAL_ERRORS.notFound);
  if (user.role === "nurse" && credential.nurseId !== user.id) {
    throw new HttpError(403, CREDENTIAL_ERRORS.fileForbidden);
  }
  if (!credential.file) throw new HttpError(404, CREDENTIAL_ERRORS.noFile);

  const { bytes } = await getDb().credentialFile.findUniqueOrThrow({
    where: { credentialId },
    select: { bytes: true },
  });
  return { ...credential.file, bytes };
}

// --- Review ------------------------------------------------------------------

const ReviewBody = z.object(
  {
    decision: z.enum(["approved", "rejected"], { error: CREDENTIAL_ERRORS.badDecision }),
    reason: z.string({ error: CREDENTIAL_ERRORS.badReason }).optional(),
  },
  { error: "Request body must be a JSON object" },
);

export type ReviewInput = { decision: "approved"; reason: null } | { decision: "rejected"; reason: string };

/** Validates a POST /api/credentials/:id/review body. A rejection needs a reason; an approval ignores one. */
export function parseReview(body: unknown): ReviewInput {
  const parsed = ReviewBody.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const { decision } = parsed.data;
  if (decision === "approved") return { decision, reason: null };
  const reason = parsed.data.reason?.trim() ?? "";
  if (!reason) throw new HttpError(400, CREDENTIAL_ERRORS.reasonRequired);
  if (reason.length > REJECTION_REASON_MAX) throw new HttpError(400, CREDENTIAL_ERRORS.reasonTooLong);
  return { decision, reason };
}

/**
 * Approves or rejects a pending credential, audited in the same transaction.
 * The UPDATE only matches a pending row: if another review committed first,
 * Postgres re-checks the status on the committed row and it matches 0 rows.
 */
export async function reviewCredential(
  admin: SessionUser,
  credentialId: string,
  input: ReviewInput,
): Promise<CredentialDto> {
  const { decision, reason } = input;
  return getDb().$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE "Credential"
      SET "status" = ${decision}::"CredentialStatus", "reviewedById" = ${admin.id},
          "reviewedAt" = now(), "rejectionReason" = ${reason}
      WHERE "id" = ${credentialId} AND "status" = 'pending'`;
    if (updated !== 1) {
      const exists = await tx.credential.findUnique({ where: { id: credentialId }, select: { id: true } });
      throw exists
        ? new HttpError(409, CREDENTIAL_ERRORS.alreadyReviewed)
        : new HttpError(404, CREDENTIAL_ERRORS.notFound);
    }

    const row = await tx.credential.findUniqueOrThrow({ where: { id: credentialId }, select: credentialSelect });
    await writeAudit(tx, {
      actor: { id: admin.id, role: admin.role },
      action: decision === "approved" ? "credential.approved" : "credential.rejected",
      credentialId,
      details: {
        nurseId: row.nurseId,
        status: { from: "pending", to: decision },
        ...(reason === null ? {} : { reason }),
      },
    });
    return toCredentialDto(row);
  }, WRITE_TX_OPTIONS);
}
