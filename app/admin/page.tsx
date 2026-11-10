import { redirect } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { getAdminDashboard } from "@/lib/admin";
import { requireSessionUser } from "@/lib/session";
import { AdminDashboard } from "./AdminDashboard";

export default async function AdminPage() {
  const user = await requireSessionUser();
  if (user.role !== "admin") redirect("/");
  const dashboard = await getAdminDashboard();

  return (
    <main className="page page-wide">
      <AppHeader user={user} />
      <AdminDashboard initial={dashboard} />
    </main>
  );
}
