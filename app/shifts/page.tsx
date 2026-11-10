import { AppHeader } from "@/app/components/AppHeader";
import { requireSessionUser } from "@/lib/session";
import { listShifts } from "@/lib/shifts";
import { ShiftBoard } from "./ShiftBoard";

export default async function ShiftsPage() {
  const user = await requireSessionUser();
  // Every shift, as GET /api/shifts returns them; the board shows the open ones
  // and, for a nurse, the ones they hold.
  const shifts = await listShifts();

  return (
    <main className="page">
      <AppHeader user={user} />
      <h1>Open shifts</h1>
      <ShiftBoard initialShifts={shifts} nurseId={user.role === "nurse" ? user.id : null} />
    </main>
  );
}
