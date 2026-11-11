import { withAuth } from "@/lib/auth";
import { CREDENTIAL_ERRORS, listCredentials, parseStatusFilter, parseUpload, uploadCredential } from "@/lib/credentials";
import { HttpError } from "@/lib/http";
import { todayIsoUtc } from "@/lib/shift-time";

// Nurse: own credentials. Admin: all (`?status=pending` is the review queue).
// Agency: every nurse's credentials, status only. See lib/credentials.ts.
// `today` is the server's UTC date, which pages use to label expiry.
export const GET = withAuth(async (req, user) => {
  const status = parseStatusFilter(req.nextUrl.searchParams.get("status"));
  return Response.json({ credentials: await listCredentials(user, status), today: todayIsoUtc() });
});

// A nurse uploads a credential: multipart/form-data with `file` (PDF, PNG or
// JPEG, up to 4 MB) and `expiresOn` (YYYY-MM-DD). It starts pending.
export const POST = withAuth(async (req, user) => {
  // Checked before the body is read, so other roles never upload anything.
  if (user.role !== "nurse") throw new HttpError(403, CREDENTIAL_ERRORS.nurseOnly);
  const input = await parseUpload(req);
  return Response.json(await uploadCredential(user, input), { status: 201 });
});
