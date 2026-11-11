import { AppHeader } from "@/app/components/AppHeader";
import { listNurseCredentials } from "@/lib/credentials";
import { requireSessionUser } from "@/lib/session";
import { isoDate, startOfTodayUtc } from "@/lib/shift-time";
import { listShifts } from "@/lib/shifts";
import { ShiftBoard } from "./ShiftBoard";

export default async function ShiftsPage() {
  const user = await requireSessionUser();
  // Every shift, as GET /api/shifts returns them; the board shows the open ones
  // and, for a nurse, the ones they hold and their credentials.
  const [shifts, credentials] = await Promise.all([
    listShifts(),
    user.role === "nurse" ? listNurseCredentials(user.id) : null,
  ]);
  const nurse = credentials ? { id: user.id, credentials, today: isoDate(startOfTodayUtc()) } : null;

  return (
    <main className="page">
      <AppHeader user={user} />
      <h1>Open shifts</h1>
      <ShiftBoard initialShifts={shifts} nurse={nurse} />
    </main>
  );
}
