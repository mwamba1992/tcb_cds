-- AlterTable
ALTER TABLE "batch_submissions" ADD COLUMN     "breaks" JSONB,
ADD COLUMN     "packages" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reconcile_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reconcile_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
ADD COLUMN     "reconciled_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "winners_checks" (
    "isin" VARCHAR(12) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "callbacks_total" DECIMAL(20,2) NOT NULL,
    "winners_total" DECIMAL(20,2) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winners_checks_pkey" PRIMARY KEY ("isin")
);

-- CreateIndex
CREATE INDEX "batch_submissions_reconcile_status_submitted_at_idx" ON "batch_submissions"("reconcile_status", "submitted_at");
