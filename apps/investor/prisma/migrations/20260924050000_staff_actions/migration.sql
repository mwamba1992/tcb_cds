-- AlterTable
ALTER TABLE "cds_requests" ADD COLUMN     "completed_by_name" VARCHAR(120);

-- AlterTable
ALTER TABLE "kyc_cases" ADD COLUMN     "checker_name" VARCHAR(120),
ADD COLUMN     "maker_name" VARCHAR(120);

-- CreateTable
CREATE TABLE "staff_actions" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" VARCHAR(120),
    "actor_role" VARCHAR(40) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "subject_type" VARCHAR(20) NOT NULL,
    "subject_ref" VARCHAR(12) NOT NULL,
    "investor_id" UUID NOT NULL,
    "note" VARCHAR(500),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_actions_investor_id_at_idx" ON "staff_actions"("investor_id", "at");

-- CreateIndex
CREATE INDEX "staff_actions_actor_id_at_idx" ON "staff_actions"("actor_id", "at");

