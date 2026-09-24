-- CreateTable
CREATE TABLE "account_opening_requests" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "investor_id" UUID NOT NULL,
    "nida_number" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'requested',
    "customer_id" VARCHAR(40),
    "account_number" VARCHAR(20),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(6),

    CONSTRAINT "account_opening_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_opening_requests_reference_key" ON "account_opening_requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "account_opening_requests_investor_id_key" ON "account_opening_requests"("investor_id");

-- CreateIndex
CREATE INDEX "account_opening_requests_status_idx" ON "account_opening_requests"("status");

