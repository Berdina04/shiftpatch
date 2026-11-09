-- CreateEnum
CREATE TYPE "Role" AS ENUM ('nurse', 'agency', 'admin');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'filled');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "agencyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "expiresOn" DATE NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "claimedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Credential_nurseId_idx" ON "Credential"("nurseId");

-- CreateIndex
CREATE INDEX "Shift_agencyId_idx" ON "Shift"("agencyId");

-- CreateIndex
CREATE INDEX "Shift_claimedById_idx" ON "Shift"("claimedById");

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: a filled shift always has a claimant and an open one never does;
-- times are HH:MM and a shift can't start and end at the same time.
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_claim_matches_status"
  CHECK (("status" = 'filled') = ("claimedById" IS NOT NULL));
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_time_format"
  CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "startTime" <> "endTime");
