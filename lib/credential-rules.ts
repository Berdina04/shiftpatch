// Credential upload rules (plan.md, Part 4). Safe to import from client
// components (no database code): the upload form checks the size before
// sending, because Vercel rejects request bodies over 4.5 MB before the route
// runs, and the nurse would get no useful message.

export const MAX_CREDENTIAL_FILE_BYTES = 4 * 1024 * 1024;

export const CREDENTIAL_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type CredentialFileType = (typeof CREDENTIAL_FILE_TYPES)[number];

export const REJECTION_REASON_MAX = 500;

export const CREDENTIAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const FILE_TOO_LARGE = "File must be 4 MB or smaller";
export const FILE_EMPTY = "File is empty";

/** The client-side check run before uploading; null when the size is fine. */
export function fileSizeProblem(size: number): string | null {
  if (size === 0) return FILE_EMPTY;
  if (size > MAX_CREDENTIAL_FILE_BYTES) return FILE_TOO_LARGE;
  return null;
}

export type DisplayStatus = CredentialStatus | "expired";

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  expired: "Expired",
  rejected: "Rejected",
};

/**
 * The status a person reads. An approved credential whose expiry date has
 * come is "expired": the expiry date itself is not valid (plan.md). `today`
 * is YYYY-MM-DD, from the server, so the page renders the same on both sides.
 */
export function displayStatus(c: { status: CredentialStatus; expiresOn: string }, today: string): DisplayStatus {
  if (c.status !== "approved") return c.status;
  return Date.parse(c.expiresOn) <= Date.parse(today) ? "expired" : "approved";
}

/** 1536 → "1.5 KB" */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
