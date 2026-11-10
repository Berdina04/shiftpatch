import type { SessionUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export function AppHeader({ user }: { user: SessionUser }) {
  return (
    <header className="topbar">
      <strong>ShiftPatch</strong>
      <span className="muted">
        {user.name} · {user.role}
      </span>
      <LogoutButton />
    </header>
  );
}
