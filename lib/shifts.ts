// The one shift shape every route returns (docs/spec.md).
import { getDb } from "./db";
import type { Prisma } from "./generated/prisma/client";

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
    date: row.date.toISOString().slice(0, 10),
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    claimedBy: row.claimedById,
  };
}

export async function listShifts(where: Prisma.ShiftWhereInput = {}): Promise<ShiftDto[]> {
  const rows = await getDb().shift.findMany({
    where,
    select: shiftSelect,
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });
  return rows.map(toShiftDto);
}
