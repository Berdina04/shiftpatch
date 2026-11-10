-- Part 2: audit log, and database-generated shift ids (shift-<n>, plan.md).

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_shiftId_idx" ON "AuditLog"("shiftId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- Hand-written: shift ids. The sequence is owned by "Shift"."id", so the reset
-- script's TRUNCATE ... RESTART IDENTITY restarts it at 4 (after the seed's shift-1..3).
CREATE SEQUENCE "shift_id_seq" START 4 OWNED BY "Shift"."id";
-- Continue after any shift-<n> that already exists (production only has the seed's).
SELECT setval('shift_id_seq', GREATEST(3, COALESCE(
  (SELECT max(substring("id" from '^shift-([0-9]+)$')::bigint) FROM "Shift"), 3)));
ALTER TABLE "Shift" ALTER COLUMN "id" SET DEFAULT ('shift-'::text || nextval('shift_id_seq'::regclass));
