import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

// Each role's landing page (app/page.tsx), plus the timesheets every role has.
const HOME = {
  nurse: { href: "/shifts", label: "Shifts" },
  agency: { href: "/agency", label: "Your shifts" },
  admin: { href: "/admin", label: "Dashboard" },
} as const;

export function AppHeader({ user }: { user: SessionUser }) {
  const home = HOME[user.role];
  return (
    <header className="topbar">
      <strong>ShiftPatch</strong>
      <nav className="topnav">
        <Link href={home.href}>{home.label}</Link>
        <Link href="/timesheets">Timesheets</Link>
      </nav>
      <span className="muted">
        {user.name} · {user.role}
      </span>
      <LogoutButton />
    </header>
  );
}
