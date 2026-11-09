import { requireSessionUser } from "@/lib/session";
import { listShifts, type ShiftDto } from "@/lib/shifts";
import { LogoutButton } from "./LogoutButton";

export default async function ShiftsPage() {
  const user = await requireSessionUser();
  const shifts = await listShifts({ status: "open" });

  return (
    <main className="page">
      <header className="topbar">
        <strong>ShiftPatch</strong>
        <span className="muted">
          {user.name} · {user.role}
        </span>
        <LogoutButton />
      </header>

      <h1>Open shifts</h1>
      {shifts.length === 0 ? (
        <p className="muted">No open shifts right now.</p>
      ) : (
        <ul className="shift-list">
          {shifts.map((shift) => (
            <ShiftListItem key={shift.id} shift={shift} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ShiftListItem({ shift }: { shift: ShiftDto }) {
  const overnight = shift.endTime < shift.startTime;
  return (
    <li className="card shift" data-testid="shift-list-item" data-shift-id={shift.id}>
      <div>
        <strong>{shift.role}</strong> · {shift.agencyName}
      </div>
      <div className="muted">
        {shift.date} · {shift.startTime}–{shift.endTime}
        {overnight && " (+1 day)"}
      </div>
    </li>
  );
}
