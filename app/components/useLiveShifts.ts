"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShiftDto } from "@/lib/shifts";

export const POLL_INTERVAL_MS = 10_000;

/**
 * Data that polls `url` every 10 s (docs/decisions.md #4). `refresh()`
 * refetches at once (used after a 409). Only the newest request may update the
 * data, so a slow, older poll can't bring back a state that is already gone.
 * `select` turns the response body into the data; pass a stable function.
 */
export function usePolled<T>(url: string, initial: T, select: (body: unknown) => T) {
  const router = useRouter();
  const [data, setData] = useState(initial);
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
      const body: unknown = await res.json();
      if (request !== latestRequest.current) return;
      setData(select(body));
    } catch {
      // Offline or a network blip: keep the current data; the next poll retries.
    }
  }, [url, select, router]);

  /** A local change (e.g. after a claim) that in-flight polls must not overwrite. */
  const update = useCallback((change: (current: T) => T) => {
    latestRequest.current++;
    setData(change);
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { data, refresh, update };
}

const selectShifts = (body: unknown) => (body as { shifts: ShiftDto[] }).shifts;

/** A shift list (`{ shifts }`) that polls `url` every 10 s. */
export function useLiveShifts(url: string, initial: ShiftDto[]) {
  const { data: shifts, refresh, update } = usePolled(url, initial, selectShifts);
  return { shifts, refresh, update };
}
