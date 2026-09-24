-- CreateTable
CREATE TABLE "bot_callbacks" (
    "id" UUID NOT NULL,
    "dedupe_key" VARCHAR(64) NOT NULL,
    "request_id" VARCHAR(64),
    "batch_reference" VARCHAR(32),
    "isin" VARCHAR(12),
    "status" VARCHAR(40),
    "message" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_snapshots" (
    "isin" VARCHAR(12) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auction_snapshots_pkey" PRIMARY KEY ("isin")
);

-- CreateTable
CREATE TABLE "batch_submissions" (
    "batch_reference" VARCHAR(32) NOT NULL,
    "requested_by" VARCHAR(40) NOT NULL,
    "bids_submitted" INTEGER NOT NULL,
    "total_face_value" DECIMAL(20,2) NOT NULL,
    "already_submitted" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_submissions_pkey" PRIMARY KEY ("batch_reference")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_callbacks_dedupe_key_key" ON "bot_callbacks"("dedupe_key");

-- CreateIndex
CREATE INDEX "bot_callbacks_request_id_idx" ON "bot_callbacks"("request_id");

-- CreateIndex
CREATE INDEX "bot_callbacks_batch_reference_idx" ON "bot_callbacks"("batch_reference");
