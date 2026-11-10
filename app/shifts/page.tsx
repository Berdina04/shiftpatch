import { AppHeader } from "@/app/components/AppHeader";
import { requireSessionUser } from "@/lib/session";
import { listShifts } from "@/lib/shifts";
import { OpenShiftList } from "./OpenShiftList";

export default async function ShiftsPage() {
  const user = await requireSessionUser();
  const shifts = await listShifts({ status: "open" });

  return (
    <main className="page">
      <AppHeader user={user} />
      <h1>Open shifts</h1>
      <OpenShiftList initialShifts={shifts} canClaim={user.role === "nurse"} />
    </main>
  );
}
