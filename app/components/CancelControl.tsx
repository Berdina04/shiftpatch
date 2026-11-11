"use client";

import { useState } from "react";
import { CANCEL_REASON_LABELS, type CancelReason } from "@/lib/cancel-reasons";
import type { CancelledShiftDto } from "@/lib/cancellations";
import type { ShiftDto } from "@/lib/shifts";

export type CancelResult = { ok: true; shift: CancelledShiftDto } | { ok: false; status: number; error: string };

/**
 * POST /api/shifts/:id/cancel. Sends the nurse this page shows as `nurseId`,
 * so a stale page gets a 409 instead of cancelling another nurse's claim.
 */
export async function requestCancel(shift: ShiftDto, reason: CancelReason): Promise<CancelResult> {
  try {
    const res = await fetch(`/api/shifts/${encodeURIComponent(shift.id)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, nurseId: shift.claimedBy ?? undefined }),
    });
    const body = (await res.json().catch(() => null)) as (CancelledShiftDto & { error?: string }) | null;
    if (res.ok && body) return { ok: true, shift: body };
    return { ok: false, status: res.status, error: body?.error ?? "Could not cancel the shift, please try again" };
  } catch {
    return { ok: false, status: 0, error: "Network error, please try again" };
  }
}

type Props = {
  reasons: readonly CancelReason[];
  label: string;
  busy: boolean;
  disabled: boolean;
  onCancel: (reason: CancelReason) => void;
};

/**
 * The cancel button for one claimed shift, with a reason picker when there is
 * a choice. The picker starts empty and the button stays disabled until a
 * reason is picked: a no-show stays on the nurse's record, so it is never a
 * default (review of Part 3, finding 3). With one reason (a nurse's advance
 * cancellation) the button works at once.
 */
export function CancelControl({ reasons, label, busy, disabled, onCancel }: Props) {
  const [reason, setReason] = useState<CancelReason | null>(reasons.length === 1 ? reasons[0] : null);
  return (
    <div className="cancel-control">
      {reasons.length > 1 && (
        <select aria-label="Reason" value={reason ?? ""} onChange={(e) => setReason(e.target.value as CancelReason)}>
          <option value="" disabled>
            Choose a reason
          </option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {CANCEL_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="secondary"
        data-testid="shift-cancel-button"
        disabled={disabled || reason === null}
        onClick={() => reason && onCancel(reason)}
      >
        {busy ? "Cancelling…" : label}
      </button>
    </div>
  );
}
