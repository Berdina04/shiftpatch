import { withAuth } from "@/lib/auth";
import { listShifts } from "@/lib/shifts";

// Every shift across both agencies; any logged-in role may read it (plan.md).
export const GET = withAuth(async () => {
  return Response.json({ shifts: await listShifts() });
});
