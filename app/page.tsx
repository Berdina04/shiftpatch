import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Agencies manage their own shifts; nurses and (until Part 3) the admin see the open list.
  redirect(user.role === "agency" ? "/agency" : "/shifts");
}
