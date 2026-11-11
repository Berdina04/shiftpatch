import { withAuth } from "@/lib/auth";
import { CREDENTIAL_ERRORS, parseReview, reviewCredential } from "@/lib/credentials";
import { HttpError, readJson } from "@/lib/http";

// Admin only: approve, or reject with a reason, a pending credential.
// Body: { "decision": "approved" } or { "decision": "rejected", "reason": "…" }.
export const POST = withAuth<RouteContext<"/api/credentials/[id]/review">>(async (req, user, ctx) => {
  if (user.role !== "admin") throw new HttpError(403, CREDENTIAL_ERRORS.adminOnly);
  const input = parseReview(await readJson(req));
  const { id } = await ctx.params;
  return Response.json(await reviewCredential(user, id, input));
});
