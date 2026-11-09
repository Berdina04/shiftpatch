import bcrypt from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions, signToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { HttpError, readJson, toErrorResponse } from "@/lib/http";

const LoginBody = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

// Compared against when the email is unknown, so both failures take as long.
const DUMMY_HASH = "$2b$10$RH9YTnzi/t1E6Nj9hcN48udo.jORyd/MzfZD6aTYcsXrDyH3EQYDm";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const parsed = LoginBody.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "Email and password are required");
    const { email, password } = parsed.data;

    const user = await getDb().user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, name: true, role: true, passwordHash: true },
    });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) throw new HttpError(401, "Invalid email or password");

    const token = await signToken(user.id);
    const res = NextResponse.json({
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
