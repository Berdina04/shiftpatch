"use client";

import { useState } from "react";
import { CancelControl, requestCancel } from "@/app/components/CancelControl";
import { NotificationBanner, type Banner } from "@/app/components/NotificationBanner";
import { ShiftTimes } from "@/app/components/ShiftTimes";
import { useLiveShifts } from "@/app/components/useLiveShifts";
import { CANCEL_REASONS, type CancelReason } from "@/lib/cancel-reasons";
import type { ShiftDto } from "@/lib/shifts";
import { PostShiftForm } from "./PostShiftForm";

export function AgencyShifts({ agencyId, initialShifts }: { agencyId: string; initialShifts: ShiftDto[] }) {
  const { shifts, refresh, update } = useLiveShifts(`/api/agencies/${encodeURIComponent(agencyId)}/shifts`, initialShifts);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function onPosted() {
    setBanner({ kind: "success", text: "Shift posted" });
    setFormOpen(false);
    await refresh();
  }

  // A no-show or an advance cancellation reopens the shift (plan.md, Part 3).
  async function cancel(shift: ShiftDto, reason: CancelReason) {
    setCancelling(shift.id);
    try {
      const result = await requestCancel(shift, reason);
      if (result.ok) {
        setBanner({ kind: "success", text: `Shift reopened (${reason})` });
        update((current) => current.map((s) => (s.id === shift.id ? result.shift : s)));
        return;
      }
      setBanner({ kind: "error", text: result.error });
      // 409: the list is out of date, so refresh now instead of at the next poll.
      if (result.status === 409) await refresh();
    } finally {
      setCancelling(null);
    }
  }

  return (
    <>
      <div className="heading-row">
        <h1>Your shifts</h1>
        <button type="button" data-testid="agency-post-shift-button" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? "Close" : "Post a shift"}
        </button>
      </div>
      <NotificationBanner banner={banner} />
      {formOpen && <PostShiftForm onPosted={onPosted} onError={(text) => setBanner({ kind: "error", text })} />}
      {shifts.length === 0 ? (
        <p className="muted">You haven&apos;t posted any shifts yet.</p>
      ) : (
        <ul className="shift-list">
          {shifts.map((shift) => (
            <li key={shift.id} className="card shift" data-shift-id={shift.id}>
              <div>
                <div>
                  <strong>{shift.role}</strong> · {shift.id}
                </div>
                <ShiftTimes shift={shift} />
              </div>
              <div className="shift-actions">
                <span className={`status status-${shift.status}`}>
                  {shift.status === "open" ? "Open" : `Filled · ${shift.claimedBy}`}
                </span>
                {shift.status === "filled" && (
                  <CancelControl
                    reasons={CANCEL_REASONS}
                    label="Reopen shift"
                    busy={cancelling === shift.id}
                    disabled={cancelling !== null}
                    onCancel={(reason) => cancel(shift, reason)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
