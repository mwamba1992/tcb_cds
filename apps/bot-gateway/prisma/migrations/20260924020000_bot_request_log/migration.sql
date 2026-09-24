-- CreateTable
CREATE TABLE "bot_request_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(200) NOT NULL,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_code" VARCHAR(60),
    "batch_reference" VARCHAR(32),
    "clock_skew_sec" INTEGER,

    CONSTRAINT "bot_request_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_request_log_at_idx" ON "bot_request_log"("at");

-- CreateIndex
CREATE INDEX "bot_request_log_batch_reference_idx" ON "bot_request_log"("batch_reference");
