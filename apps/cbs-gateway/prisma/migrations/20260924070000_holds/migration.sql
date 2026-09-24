-- CreateTable
CREATE TABLE "funds_holds" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "account_number" VARCHAR(20) NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'held',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "funds_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funds_holds_reference_key" ON "funds_holds"("reference");

-- CreateIndex
CREATE INDEX "funds_holds_account_number_status_idx" ON "funds_holds"("account_number", "status");

