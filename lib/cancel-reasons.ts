// Safe to import from client components (no database code).
// "no-show": the nurse didn't turn up; "advance": cancelled ahead of time (spec).
export const CANCEL_REASONS = ["no-show", "advance"] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  "no-show": "No-show",
  advance: "Cancelled in advance",
};
