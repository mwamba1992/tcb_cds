-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(16) NOT NULL,
    "role" VARCHAR(40) NOT NULL DEFAULT 'investor',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "pin_hash" TEXT,
    "pin_set_at" TIMESTAMPTZ(6),
    "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_at" TIMESTAMPTZ(6),
    "locale" VARCHAR(2) NOT NULL DEFAULT 'sw',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(80) NOT NULL,
    "rotated_to_id" UUID,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(16) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_grants" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "max_amount" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_phone_number_key" ON "accounts"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_account_id_revoked_at_idx" ON "sessions"("account_id", "revoked_at");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_number_purpose_created_at_idx" ON "otp_challenges"("phone_number", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "step_up_grants_account_id_idx" ON "step_up_grants"("account_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_up_grants" ADD CONSTRAINT "step_up_grants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

