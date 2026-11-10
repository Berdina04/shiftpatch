import { redirect } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { requireSessionUser } from "@/lib/session";
import { listShifts } from "@/lib/shifts";
import { AgencyShifts } from "./AgencyShifts";

export default async function AgencyPage() {
  const user = await requireSessionUser();
  if (user.role !== "agency" || !user.agencyId) redirect("/");
  const shifts = await listShifts({ agencyId: user.agencyId });

  return (
    <main className="page">
      <AppHeader user={user} />
      <AgencyShifts agencyId={user.agencyId} initialShifts={shifts} />
    </main>
  );
}
