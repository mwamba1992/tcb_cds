-- CreateTable
CREATE TABLE "auctions" (
    "id" UUID NOT NULL,
    "isin" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "instrument" VARCHAR(4) NOT NULL,
    "auction_date" DATE,
    "maturity_date" DATE,
    "competitive_offer" VARCHAR(24) NOT NULL,
    "non_competitive_offer" VARCHAR(24) NOT NULL,
    "bot_status" VARCHAR(10) NOT NULL,
    "bot_close_at" TIMESTAMPTZ(6),
    "tcb_cutoff_at" TIMESTAMPTZ(6),
    "closed_early_by" VARCHAR(120),
    "closed_early_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "auction_id" UUID NOT NULL,
    "isin" VARCHAR(12) NOT NULL,
    "investor_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "cds_account" VARCHAR(20) NOT NULL,
    "bank_account" VARCHAR(20) NOT NULL,
    "competitive" BOOLEAN NOT NULL,
    "face_value" BIGINT NOT NULL,
    "price_hundredths" INTEGER,
    "held_minor" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'placed',
    "channel" VARCHAR(10) NOT NULL DEFAULT 'web',
    "batch_id" UUID,
    "bot_request_id" VARCHAR(64),
    "allotted_face_value" BIGINT,
    "allotted_price_hundredths" INTEGER,
    "bot_message" VARCHAR(300),
    "idempotency_key" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(19) NOT NULL,
    "auction_id" UUID NOT NULL,
    "isin" VARCHAR(12) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'prepared',
    "bid_count" INTEGER NOT NULL,
    "total_face_value" BIGINT NOT NULL,
    "total_held_minor" BIGINT NOT NULL,
    "prepared_by" UUID NOT NULL,
    "prepared_by_name" VARCHAR(120),
    "prepared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_by_name" VARCHAR(120),
    "approved_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "reconciled_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(500),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_outcomes" (
    "id" BIGSERIAL NOT NULL,
    "event_key" VARCHAR(200) NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(14) NOT NULL,
    "allotted_face_value" VARCHAR(24),
    "allotted_price" VARCHAR(12),
    "message" VARCHAR(300),
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "bid_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auctions_isin_key" ON "auctions"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "bids_reference_key" ON "bids"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "bids_bot_request_id_key" ON "bids"("bot_request_id");

-- CreateIndex
CREATE INDEX "bids_account_id_created_at_idx" ON "bids"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "bids_isin_status_idx" ON "bids"("isin", "status");

-- CreateIndex
CREATE INDEX "bids_batch_id_idx" ON "bids"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "bids_account_id_idempotency_key_key" ON "bids"("account_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "batches_reference_key" ON "batches"("reference");

-- CreateIndex
CREATE INDEX "batches_status_prepared_at_idx" ON "batches"("status", "prepared_at");

-- CreateIndex
CREATE UNIQUE INDEX "bid_outcomes_event_key_key" ON "bid_outcomes"("event_key");

-- CreateIndex
CREATE INDEX "bid_outcomes_request_id_applied_at_idx" ON "bid_outcomes"("request_id", "applied_at");

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

