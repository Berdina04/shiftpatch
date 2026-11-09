import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/shifts");
  return (
    <main className="auth-page">
      <h1>ShiftPatch</h1>
      <p className="muted">Log in to see open shifts.</p>
      <LoginForm />
    </main>
  );
}
