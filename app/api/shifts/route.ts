import { withAuth } from "@/lib/auth";
import { HttpError, readJson } from "@/lib/http";
import { listShifts, parseNewShift, postShift } from "@/lib/shifts";

// Every shift across both agencies; any logged-in role may read it (plan.md).
export const GET = withAuth(async () => {
  return Response.json({ shifts: await listShifts() });
});

// An agency posts an open shift, always under its own agencyId (spec).
export const POST = withAuth(async (req, user) => {
  if (user.role !== "agency" || !user.agencyId) {
    throw new HttpError(403, "Only agencies can post shifts");
  }
  const input = parseNewShift(await readJson(req));
  const shift = await postShift({ ...user, agencyId: user.agencyId }, input);
  return Response.json(shift, { status: 201 });
});
