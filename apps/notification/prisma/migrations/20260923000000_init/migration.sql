-- CreateTable
CREATE TABLE "delivery_log" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "destination_mask" VARCHAR(64) NOT NULL,
    "template_key" VARCHAR(100) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "provider_ref" VARCHAR(100),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_log_created_at_idx" ON "delivery_log"("created_at");
