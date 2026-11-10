import { withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { listShifts } from "@/lib/shifts";

const FORBIDDEN = "You can only view your own agency's shifts";

// An agency reads its own shifts; the admin may read any agency's.
// Another agency's id is 403 for an agency, so ids of unknown agencies don't leak.
export const GET = withAuth<RouteContext<"/api/agencies/[agencyId]/shifts">>(async (_req, user, ctx) => {
  const { agencyId } = await ctx.params;
  if (user.role === "agency") {
    if (user.agencyId !== agencyId) throw new HttpError(403, FORBIDDEN);
  } else if (user.role === "admin") {
    const agency = await getDb().agency.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!agency) throw new HttpError(404, "Agency not found");
  } else {
    throw new HttpError(403, FORBIDDEN);
  }
  return Response.json({ agencyId, shifts: await listShifts({ agencyId }) });
});
