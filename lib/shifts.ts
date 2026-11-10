// The one shift shape every route returns (docs/spec.md), and posting a shift.
import { z } from "zod";
import { WRITE_TX_OPTIONS, writeAudit } from "./audit";
import type { SessionUser } from "./auth";
import { getDb } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { HttpError } from "./http";
import { SHIFT_ROLES } from "./shift-roles";
import { dateOnly, isCalendarDate, isoDate } from "./shift-time";

export type ShiftDto = {
  id: string;
  agencyId: string;
  agencyName: string;
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "open" | "filled";
  claimedBy: string | null;
};

export const shiftSelect = {
  id: true,
  agencyId: true,
  agency: { select: { name: true } },
  role: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  claimedById: true,
} satisfies Prisma.ShiftSelect;

type ShiftRow = Prisma.ShiftGetPayload<{ select: typeof shiftSelect }>;

export function toShiftDto(row: ShiftRow): ShiftDto {
  return {
    id: row.id,
    agencyId: row.agencyId,
    agencyName: row.agency.name,
    role: row.role,
    date: isoDate(row.date),
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    claimedBy: row.claimedById,
  };
}

/** Every shift list's order: by start, then id. */
export const shiftOrder = [
  { date: "asc" },
  { startTime: "asc" },
  { id: "asc" },
] as const satisfies Prisma.ShiftOrderByWithRelationInput[];

export async function listShifts(where: Prisma.ShiftWhereInput = {}): Promise<ShiftDto[]> {
  const rows = await getDb().shift.findMany({ where, select: shiftSelect, orderBy: [...shiftOrder] });
  return rows.map(toShiftDto);
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TIME_ERROR = "startTime and endTime must be HH:MM (24-hour)";

const NewShiftBody = z
  .object(
    {
      role: z.enum(SHIFT_ROLES, { error: "role must be RN or LPN" }),
      date: z
        .string({ error: "date must be a valid date (YYYY-MM-DD)" })
        .refine(isCalendarDate, { error: "date must be a valid date (YYYY-MM-DD)" }),
      startTime: z.string({ error: TIME_ERROR }).regex(HHMM, { error: TIME_ERROR }),
      endTime: z.string({ error: TIME_ERROR }).regex(HHMM, { error: TIME_ERROR }),
    },
    { error: "Request body must be a JSON object" },
  )
  // endTime < startTime is an overnight shift; equal times are not a shift.
  .refine((b) => b.startTime !== b.endTime, { error: "startTime and endTime must differ" });

export type NewShift = z.infer<typeof NewShiftBody>;

/** Validates a POST /api/shifts body; any other field (e.g. agencyId) is ignored. */
export function parseNewShift(body: unknown): NewShift {
  const parsed = NewShiftBody.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  return parsed.data;
}

/** Posts an open shift for the agency's own agencyId, audited in the same transaction. */
export async function postShift(agency: SessionUser & { agencyId: string }, input: NewShift): Promise<ShiftDto> {
  return getDb().$transaction(async (tx) => {
    const row = await tx.shift.create({
      data: {
        agencyId: agency.agencyId,
        role: input.role,
        date: dateOnly(input.date),
        startTime: input.startTime,
        endTime: input.endTime,
      },
      select: shiftSelect,
    });
    await writeAudit(tx, {
      actor: { id: agency.id, role: agency.role },
      action: "shift.posted",
      shiftId: row.id,
      details: { ...input },
    });
    return toShiftDto(row);
  }, WRITE_TX_OPTIONS);
}
