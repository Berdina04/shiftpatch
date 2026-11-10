"use client";

import { useState } from "react";
import { CancelControl, requestCancel } from "@/app/components/CancelControl";
import { NotificationBanner, type Banner } from "@/app/components/NotificationBanner";
import { ShiftTimes } from "@/app/components/ShiftTimes";
import { usePolled } from "@/app/components/useLiveShifts";
import type { AdminDashboard as Dashboard, AdminShiftDto, AuditEntryDto } from "@/lib/admin";
import { CANCEL_REASONS, type CancelReason } from "@/lib/cancel-reasons";

const selectDashboard = (body: unknown) => body as Dashboard;

export function AdminDashboard({ initial }: { initial: Dashboard }) {
  const { data, refresh } = usePolled("/api/admin/dashboard", initial, selectDashboard);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancel(shift: AdminShiftDto, reason: CancelReason) {
    setCancelling(shift.id);
    try {
      const result = await requestCancel(shift, reason);
      setBanner(result.ok ? { kind: "success", text: `Shift reopened (${reason})` } : { kind: "error", text: result.error });
      // The marker and the audit entry come from the server; a 409 means the table was out of date.
      if (result.ok || result.status === 409) await refresh();
    } finally {
      setCancelling(null);
    }
  }

  return (
    <>
      <h1>Admin dashboard</h1>
      <NotificationBanner banner={banner} />

      <section className="section">
        <h2>Shifts</h2>
        <div className="table-wrap">
          <table className="table" data-testid="admin-dashboard-shift-table">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Agency</th>
                <th>Role</th>
                <th>When</th>
                <th>Status</th>
                <th>Nurse</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.shifts.map((shift) => (
                <tr key={shift.id} data-shift-id={shift.id}>
                  <td className="nowrap">{shift.id}</td>
                  <td>{shift.agencyName}</td>
                  <td>{shift.role}</td>
                  <td>
                    <ShiftTimes shift={shift} />
                  </td>
                  <td>
                    <div className="status-cell">
                      <span data-testid="admin-shift-status-badge" className={`status status-${shift.status}`}>
                        {shift.status}
                      </span>
                      {shift.lastCancellation && (
                        <span
                          className="marker"
                          title={`Latest cancellation: ${shift.lastCancellation.reason}, ${shift.lastCancellation.previousNurseId}, ${formatTime(shift.lastCancellation.cancelledAt)}`}
                        >
                          reopened ({shift.lastCancellation.reason})
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{shift.claimedBy ? `${shift.claimedByName ?? shift.claimedBy} (${shift.claimedBy})` : "—"}</td>
                  <td>
                    {shift.status === "filled" && (
                      <CancelControl
                        reasons={CANCEL_REASONS}
                        label="Reopen shift"
                        busy={cancelling === shift.id}
                        disabled={cancelling !== null}
                        onCancel={(reason) => cancel(shift, reason)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Audit log</h2>
        <p className="muted hint">Successful changes, newest first (up to the latest 100). Times are UTC.</p>
        <div className="table-wrap">
          <table className="table" data-testid="audit-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Shift</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.auditLog.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No changes yet.
                  </td>
                </tr>
              ) : (
                data.auditLog.map((entry) => (
                  <tr key={entry.id} data-audit-id={entry.id}>
                    <td className="nowrap">{formatTime(entry.createdAt)}</td>
                    <td>
                      {entry.actorId} ({entry.actorRole})
                    </td>
                    <td>{entry.action}</td>
                    <td className="nowrap">{entry.shiftId}</td>
                    <td>{describe(entry)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** 2026-11-10T12:00:03.123Z → 2026-11-10 12:00:03 */
function formatTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function describe(entry: AuditEntryDto): string {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "shift.posted":
      return `${d.role} · ${d.date} ${d.startTime}–${d.endTime}`;
    case "shift.claimed":
      return `claimed by ${d.claimedBy}`;
    case "shift.cancelled":
      return `${d.reason} · previous nurse ${d.previousNurseId}`;
    default:
      return JSON.stringify(entry.details);
  }
}
