-- Part 4: credential uploads with admin review (plan.md). The file is stored
-- in Postgres, in its own table, written in the same transaction as its
-- credential. Credential changes are audited like shift changes.

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

-- CreateTable
CREATE TABLE "CredentialFile" (
    "credentialId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "CredentialFile_pkey" PRIMARY KEY ("credentialId")
);

-- CreateIndex
CREATE INDEX "Credential_status_idx" ON "Credential"("status");

-- AddForeignKey
ALTER TABLE "CredentialFile" ADD CONSTRAINT "CredentialFile_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "shiftId" DROP NOT NULL,
ADD COLUMN "credentialId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_credentialId_idx" ON "AuditLog"("credentialId");

-- Hand-written: credential ids cred-<n>. The sequence is owned by
-- "Credential"."id", so the reset script's TRUNCATE ... RESTART IDENTITY
-- restarts it. The seed's ids (cred-nurse-1, cred-nurse-2) never collide.
CREATE SEQUENCE "credential_id_seq" OWNED BY "Credential"."id";
ALTER TABLE "Credential" ALTER COLUMN "id" SET DEFAULT ('cred-'::text || nextval('credential_id_seq'::regclass));

-- Hand-written: a pending credential has no review; a rejection always has a
-- reason and nothing else does. (Seeded credentials are approved without a review.)
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_review_matches_status"
  CHECK (("status" <> 'pending' OR ("reviewedAt" IS NULL AND "reviewedById" IS NULL))
     AND (("status" = 'rejected') = ("rejectionReason" IS NOT NULL)));

-- Hand-written: the three accepted file types and the 4 MB limit (plan.md).
ALTER TABLE "CredentialFile" ADD CONSTRAINT "CredentialFile_type_and_size"
  CHECK ("contentType" IN ('application/pdf', 'image/png', 'image/jpeg')
     AND "size" BETWEEN 1 AND 4194304
     AND octet_length("bytes") = "size");

-- Hand-written: every audit entry is about exactly one shift or one credential.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_one_subject"
  CHECK (num_nonnulls("shiftId", "credentialId") = 1);
