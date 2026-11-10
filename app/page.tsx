import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

const LANDING = { nurse: "/shifts", agency: "/agency", admin: "/admin" } as const;

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(LANDING[user.role]);
}
