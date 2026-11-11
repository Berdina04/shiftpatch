-- Part 3: each shift's cancellation history (plan.md). No foreign keys to
-- "User": see the ShiftCancellation model in schema.prisma.

-- CreateTable
CREATE TABLE "ShiftCancellation" (
    "id" BIGSERIAL NOT NULL,
    "shiftId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousNurseId" TEXT NOT NULL,
    "cancelledById" TEXT NOT NULL,
    "cancelledByRole" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftCancellation_shiftId_id_idx" ON "ShiftCancellation"("shiftId", "id");

-- AddForeignKey
ALTER TABLE "ShiftCancellation" ADD CONSTRAINT "ShiftCancellation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: the two reasons in the spec.
ALTER TABLE "ShiftCancellation" ADD CONSTRAINT "ShiftCancellation_reason"
  CHECK ("reason" IN ('no-show', 'advance'));
