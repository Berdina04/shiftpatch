"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShiftDto } from "@/lib/shifts";

export const POLL_INTERVAL_MS = 10_000;

/**
 * A shift list that polls `url` every 10 s (docs/decisions.md #4). `refresh()`
 * refetches at once (used after a 409). Only the newest request may update the
 * list, so a slow, older poll can't bring back a shift that is already gone.
 */
export function useLiveShifts(url: string, initial: ShiftDto[], options: { openOnly?: boolean } = {}) {
  const { openOnly = false } = options;
  const router = useRouter();
  const [shifts, setShifts] = useState(initial);
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login"); // the 8 h session expired
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { shifts: ShiftDto[] };
      if (request !== latestRequest.current) return;
      setShifts(openOnly ? body.shifts.filter((s) => s.status === "open") : body.shifts);
    } catch {
      // Offline or a network blip: keep the current list; the next poll retries.
    }
  }, [url, openOnly, router]);

  /** A local change (e.g. after a claim) that in-flight polls must not overwrite. */
  const update = useCallback((change: (current: ShiftDto[]) => ShiftDto[]) => {
    latestRequest.current++;
    setShifts(change);
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { shifts, refresh, update };
}
