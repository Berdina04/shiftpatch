import { redirect } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { listCredentialStatuses } from "@/lib/credentials";
import { requireSessionUser } from "@/lib/session";
import { isoDate, startOfTodayUtc } from "@/lib/shift-time";
import { listShifts } from "@/lib/shifts";
import { AgencyShifts } from "./AgencyShifts";
import { NurseCredentials } from "./NurseCredentials";

export default async function AgencyPage() {
  const user = await requireSessionUser();
  if (user.role !== "agency" || !user.agencyId) redirect("/");
  const [shifts, credentials] = await Promise.all([listShifts({ agencyId: user.agencyId }), listCredentialStatuses()]);

  return (
    <main className="page">
      <AppHeader user={user} />
      <AgencyShifts agencyId={user.agencyId} initialShifts={shifts} />
      <NurseCredentials initial={credentials} today={isoDate(startOfTodayUtc())} />
    </main>
  );
}
