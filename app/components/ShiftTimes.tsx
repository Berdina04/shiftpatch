import type { ShiftDto } from "@/lib/shifts";

export function ShiftTimes({ shift }: { shift: ShiftDto }) {
  const overnight = shift.endTime < shift.startTime;
  return (
    <div className="muted">
      {shift.date} · {shift.startTime}–{shift.endTime}
      {overnight && " (+1 day)"}
    </div>
  );
}
