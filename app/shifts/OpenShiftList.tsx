"use client";

import { useState } from "react";
import { NotificationBanner, type Banner } from "@/app/components/NotificationBanner";
import { ShiftTimes } from "@/app/components/ShiftTimes";
import { useLiveShifts } from "@/app/components/useLiveShifts";
import type { ShiftDto } from "@/lib/shifts";

export function OpenShiftList({ initialShifts, canClaim }: { initialShifts: ShiftDto[]; canClaim: boolean }) {
  const { shifts, refresh, update } = useLiveShifts("/api/shifts", initialShifts, { openOnly: true });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  async function claim(shiftId: string) {
    setClaiming(shiftId);
    try {
      const res = await fetch(`/api/shifts/${encodeURIComponent(shiftId)}/claim`, { method: "POST" });
      if (res.ok) {
        setBanner({ kind: "success", text: "Shift claimed" });
        update((current) => current.filter((s) => s.id !== shiftId));
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setBanner({ kind: "error", text: body?.error ?? "Could not claim the shift, please try again" });
      // 409: the list is out of date, so refresh now instead of at the next poll.
      if (res.status === 409) await refresh();
    } catch {
      setBanner({ kind: "error", text: "Network error, please try again" });
    } finally {
      setClaiming(null);
    }
  }

  return (
    <>
      <NotificationBanner banner={banner} />
      {shifts.length === 0 ? (
        <p className="muted">No open shifts right now.</p>
      ) : (
        <ul className="shift-list">
          {shifts.map((shift) => (
            <li key={shift.id} className="card shift" data-testid="shift-list-item" data-shift-id={shift.id}>
              <div>
                <div>
                  <strong>{shift.role}</strong> · {shift.agencyName}
                </div>
                <ShiftTimes shift={shift} />
              </div>
              {canClaim && (
                <button
                  type="button"
                  data-testid="shift-claim-button"
                  disabled={claiming !== null}
                  onClick={() => claim(shift.id)}
                >
                  {claiming === shift.id ? "Claiming…" : "Claim"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
