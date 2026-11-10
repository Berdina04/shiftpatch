"use client";

import { useState, type FormEvent } from "react";
import { SHIFT_ROLES } from "@/lib/shift-roles";

type Props = { onPosted: () => void | Promise<void>; onError: (message: string) => void };

export function PostShiftForm({ onPosted, onError }: Props) {
  const [role, setRole] = useState<string>(SHIFT_ROLES[0]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, date, startTime, endTime }),
      });
      if (res.ok) {
        await onPosted();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      onError(body?.error ?? "Could not post the shift, please try again");
    } catch {
      onError("Network error, please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card form post-shift-form" onSubmit={onSubmit}>
      <label>
        Role
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {SHIFT_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" name="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Start time
        <input type="time" name="startTime" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
      </label>
      <label>
        End time
        <input type="time" name="endTime" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </label>
      <p className="muted hint">An end time earlier than the start time means the shift ends the next day.</p>
      <button data-testid="agency-post-shift-submit-button" type="submit" disabled={submitting}>
        {submitting ? "Posting…" : "Post shift"}
      </button>
    </form>
  );
}
