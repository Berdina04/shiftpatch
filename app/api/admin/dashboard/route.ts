import { getAdminDashboard } from "@/lib/admin";
import { withAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";

// Admin only: every shift with its marker and claimant's name, and the newest
// audit entries. The admin dashboard polls it every 10 s.
export const GET = withAuth(async (_req, user) => {
  if (user.role !== "admin") throw new HttpError(403, "Only the admin can view the dashboard");
  return Response.json(await getAdminDashboard());
});
