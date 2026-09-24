-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "display_name" VARCHAR(120),
ADD COLUMN     "password_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "password_hash" TEXT,
ADD COLUMN     "password_locked_at" TIMESTAMPTZ(6),
ADD COLUMN     "username" VARCHAR(60),
ALTER COLUMN "phone_number" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");

