"use client";

import { useState } from "react";
import { NotificationBanner, type Banner } from "@/app/components/NotificationBanner";
import { ShiftTimes } from "@/app/components/ShiftTimes";
import { useLiveShifts } from "@/app/components/useLiveShifts";
import type { ShiftDto } from "@/lib/shifts";
import { PostShiftForm } from "./PostShiftForm";

export function AgencyShifts({ agencyId, initialShifts }: { agencyId: string; initialShifts: ShiftDto[] }) {
  const { shifts, refresh } = useLiveShifts(`/api/agencies/${encodeURIComponent(agencyId)}/shifts`, initialShifts);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function onPosted() {
    setBanner({ kind: "success", text: "Shift posted" });
    setFormOpen(false);
    await refresh();
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
              <span className={`status status-${shift.status}`}>
                {shift.status === "open" ? "Open" : `Filled · ${shift.claimedBy}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
