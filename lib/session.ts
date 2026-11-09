// Session lookup for Server Components (pages), from the httpOnly cookie.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUserForToken, SESSION_COOKIE, type SessionUser } from "./auth";

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getUserForToken(token);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
