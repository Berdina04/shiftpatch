import { withAuth } from "@/lib/auth";
import { getTimesheets } from "@/lib/timesheets";

// Scheduled hours from filled shifts, scoped by role (plan.md, Part 5): a nurse
// gets their own, an agency only its own shifts, the admin every nurse's.
export const GET = withAuth(async (_req, user) => {
  return Response.json({ timesheets: await getTimesheets(user) });
});
