import { withAuth } from "@/lib/auth";
import { cancelShift, parseCancel } from "@/lib/cancellations";
import { readJson } from "@/lib/http";

// Reopens a claimed shift (no-show or advance) and returns it with a
// `cancellation` object (spec). Permissions and checks: lib/cancellations.ts.
export const POST = withAuth<RouteContext<"/api/shifts/[id]/cancel">>(async (req, user, ctx) => {
  const input = parseCancel(await readJson(req));
  const { id } = await ctx.params;
  return Response.json(await cancelShift(user, id, input));
});
