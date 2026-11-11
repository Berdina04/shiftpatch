"use client";

import { useState } from "react";
import { CancelControl, requestCancel } from "@/app/components/CancelControl";
import { NotificationBanner, type Banner } from "@/app/components/NotificationBanner";
import { ShiftTimes } from "@/app/components/ShiftTimes";
import { useLiveShifts } from "@/app/components/useLiveShifts";
import type { ShiftDto } from "@/lib/shifts";

const NURSE_REASONS = ["advance"] as const; // nurses can't mark a no-show (plan.md)

/**
 * The open-shift list, plus "My shifts" for a nurse (`nurseId`): claim from the
 * first, cancel in advance from the second. One 10 s poll of GET /api/shifts
 * feeds both.
 */
export function ShiftBoard({ initialShifts, nurseId }: { initialShifts: ShiftDto[]; nurseId: string | null }) {
  const { shifts, refresh, update } = useLiveShifts("/api/shifts", initialShifts);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const open = shifts.filter((s) => s.status === "open");
  const mine = nurseId ? shifts.filter((s) => s.status === "filled" && s.claimedBy === nurseId) : [];
  const replace = (changed: ShiftDto) => update((current) => current.map((s) => (s.id === changed.id ? changed : s)));

  async function claim(shiftId: string) {
    setBusy(shiftId);
    try {
      const res = await fetch(`/api/shifts/${encodeURIComponent(shiftId)}/claim`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as (ShiftDto & { error?: string }) | null;
      if (res.ok && body) {
        setBanner({ kind: "success", text: "Shift claimed" });
        replace(body);
        return;
      }
      setBanner({ kind: "error", text: body?.error ?? "Could not claim the shift, please try again" });
      // 409: the list is out of date, so refresh now instead of at the next poll.
      if (res.status === 409) await refresh();
    } catch {
      setBanner({ kind: "error", text: "Network error, please try again" });
    } finally {
      setBusy(null);
    }
  }

  async function cancel(shift: ShiftDto) {
    setBusy(shift.id);
    try {
      const result = await requestCancel(shift, "advance");
      if (result.ok) {
        setBanner({ kind: "success", text: "Shift cancelled" });
        replace(result.shift);
        return;
      }
      setBanner({ kind: "error", text: result.error });
      if (result.status === 409) await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <NotificationBanner banner={banner} />
      {open.length === 0 ? (
        <p className="muted">No open shifts right now.</p>
      ) : (
        <ul className="shift-list">
          {open.map((shift) => (
            <li key={shift.id} className="card shift" data-testid="shift-list-item" data-shift-id={shift.id}>
              <div>
                <div>
                  <strong>{shift.role}</strong> · {shift.agencyName}
                </div>
                <ShiftTimes shift={shift} />
              </div>
              {nurseId && (
                <button
                  type="button"
                  data-testid="shift-claim-button"
                  disabled={busy !== null}
                  onClick={() => claim(shift.id)}
                >
                  {busy === shift.id ? "Claiming…" : "Claim"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {nurseId && (
        <section className="section">
          <h2>My shifts</h2>
          {mine.length === 0 ? (
            <p className="muted">You haven&apos;t claimed any shifts.</p>
          ) : (
            <ul className="shift-list">
              {mine.map((shift) => (
                <li key={shift.id} className="card shift" data-my-shift-id={shift.id}>
                  <div>
                    <div>
                      <strong>{shift.role}</strong> · {shift.agencyName}
                    </div>
                    <ShiftTimes shift={shift} />
                  </div>
                  <CancelControl
                    reasons={NURSE_REASONS}
                    label="Cancel shift"
                    busy={busy === shift.id}
                    disabled={busy !== null}
                    onCancel={() => cancel(shift)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
