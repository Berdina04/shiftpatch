"use client";

import { useCallback } from "react";
import type { CredentialList } from "@/lib/credential-rules";
import { usePolled } from "./useLiveShifts";

/** Adds `item`, or replaces the item with its id: never two rows for one id. */
export function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((i) => i.id === item.id) ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item];
}

const asList = (body: unknown): unknown => body;

/**
 * GET /api/credentials, polled every 10 s: the rows and the server's date
 * come together, so expiry labels follow the date while the page stays open.
 */
export function useCredentialList<T extends { id: string }>(initial: CredentialList<T>) {
  const { data, update } = usePolled("/api/credentials", initial, asList as (body: unknown) => CredentialList<T>);

  /**
   * A credential this page just saved. A poll may already have brought it in
   * (the upload committed before its response arrived), so it is merged by id
   * (review of Part 4, finding 1).
   */
  const upsert = useCallback(
    (item: T) => update((current) => ({ ...current, credentials: upsertById(current.credentials, item) })),
    [update],
  );

  return { credentials: data.credentials, today: data.today, upsert };
}
