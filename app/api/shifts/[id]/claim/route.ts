import { withAuth } from "@/lib/auth";
import { claimShift } from "@/lib/claims";
import { HttpError } from "@/lib/http";

// A nurse claims an open shift; the body is empty (spec). See lib/claims.ts.
export const POST = withAuth<RouteContext<"/api/shifts/[id]/claim">>(async (_req, user, ctx) => {
  if (user.role !== "nurse") throw new HttpError(403, "Only nurses can claim shifts");
  const { id } = await ctx.params;
  return Response.json(await claimShift(user, id));
});
