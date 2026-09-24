-- CreateTable
CREATE TABLE "unlock_requests" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_by_name" VARCHAR(120),
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_by_name" VARCHAR(120),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "unlock_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" VARCHAR(120),
    "actor_role" VARCHAR(40) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "target_id" UUID NOT NULL,
    "detail" VARCHAR(200),
    "reason" VARCHAR(500),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unlock_requests_status_created_at_idx" ON "unlock_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "unlock_requests_account_id_idx" ON "unlock_requests"("account_id");

-- CreateIndex
CREATE INDEX "admin_actions_target_id_at_idx" ON "admin_actions"("target_id", "at");

-- CreateIndex
CREATE INDEX "admin_actions_actor_id_at_idx" ON "admin_actions"("actor_id", "at");

