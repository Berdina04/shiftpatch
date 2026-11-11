import { AppHeader } from "@/app/components/AppHeader";
import { ShiftTimes } from "@/app/components/ShiftTimes";
import { requireSessionUser } from "@/lib/session";
import { formatMinutes } from "@/lib/shift-time";
import { getTimesheets } from "@/lib/timesheets";

const SCOPE = {
  nurse: "The shifts you hold.",
  agency: "Nurses on your agency's filled shifts. Totals count your agency's shifts only.",
  admin: "Every nurse's filled shifts, at every agency.",
} as const;

// Read on each page load, no polling (plan.md, Part 5): a summary, not a list
// anyone acts on. GET /api/timesheets returns the same data.
export default async function TimesheetsPage() {
  const user = await requireSessionUser();
  const timesheets = await getTimesheets(user);

  return (
    <main className="page page-wide">
      <AppHeader user={user} />
      <h1>Timesheets</h1>
      <p className="timesheet-label">Scheduled hours — not actual time worked</p>
      <p className="muted hint">
        {SCOPE[user.role]} A shift counts while it is filled, past or upcoming; a cancelled shift drops out. Reload the
        page for the latest.
      </p>

      <div className="table-wrap">
        <table className="table timesheet-table" data-testid="timesheet-table">
          <thead>
            <tr>
              <th>Nurse</th>
              <th>Shift</th>
              <th>Agency</th>
              <th>Role</th>
              <th>When</th>
              <th className="num">Scheduled hours</th>
            </tr>
          </thead>
          {timesheets.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={6} className="muted">
                  No filled shifts.
                </td>
              </tr>
            </tbody>
          ) : (
            timesheets.map((sheet) => {
              const nurse = `${sheet.nurseName} (${sheet.nurseId})`;
              return (
                <tbody key={sheet.nurseId} data-nurse-id={sheet.nurseId}>
                  {sheet.shifts.length === 0 && (
                    <tr>
                      <td>{nurse}</td>
                      <td colSpan={5} className="muted">
                        No filled shifts.
                      </td>
                    </tr>
                  )}
                  {sheet.shifts.map((shift) => (
                    <tr key={shift.id} data-shift-id={shift.id}>
                      <td>{nurse}</td>
                      <td className="nowrap">{shift.id}</td>
                      <td>{shift.agencyName}</td>
                      <td>{shift.role}</td>
                      <td>
                        <ShiftTimes shift={shift} />
                      </td>
                      <td className="num nowrap">{formatMinutes(shift.scheduledMinutes)}</td>
                    </tr>
                  ))}
                  <tr className="total-row" data-total-for={sheet.nurseId}>
                    <th scope="row" colSpan={5}>
                      Total · {sheet.nurseName}
                    </th>
                    <td className="num nowrap">{formatMinutes(sheet.totalScheduledMinutes)}</td>
                  </tr>
                </tbody>
              );
            })
          )}
        </table>
      </div>
    </main>
  );
}
