-- CreateTable
CREATE TABLE "investors" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "account_id" UUID NOT NULL,
    "type" VARCHAR(12) NOT NULL DEFAULT 'individual',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "risk" VARCHAR(8),
    "channel" VARCHAR(10) NOT NULL DEFAULT 'web',
    "bank_status" VARCHAR(10),
    "cbs_customer_id" VARCHAR(40),
    "bank_account" VARCHAR(20),
    "account_opening_ref" VARCHAR(12),
    "cds_status" VARCHAR(10) NOT NULL DEFAULT 'none',
    "cds_account" VARCHAR(20),
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "individual_profiles" (
    "investor_id" UUID NOT NULL,
    "nida_number" VARCHAR(20) NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "middle_name" VARCHAR(60),
    "last_name" VARCHAR(60) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" VARCHAR(1) NOT NULL,
    "email" VARCHAR(120),
    "region" VARCHAR(40) NOT NULL,
    "district" VARCHAR(60) NOT NULL,
    "address" VARCHAR(200) NOT NULL,
    "occupation" VARCHAR(60) NOT NULL,
    "source_of_funds" VARCHAR(20) NOT NULL,
    "tin" VARCHAR(11),
    "pep_declared" BOOLEAN NOT NULL,
    "declared_account" VARCHAR(20),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "individual_profiles_pkey" PRIMARY KEY ("investor_id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "ip_address" VARCHAR(64),
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "source" VARCHAR(12) NOT NULL,
    "outcome" VARCHAR(12) NOT NULL,
    "details" JSONB NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_cases" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "investor_id" UUID NOT NULL,
    "reasons" TEXT[],
    "risk" VARCHAR(8) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "maker_id" UUID,
    "maker_action" VARCHAR(20),
    "maker_note" VARCHAR(500),
    "maker_at" TIMESTAMPTZ(6),
    "checker_id" UUID,
    "checker_note" VARCHAR(500),
    "checker_at" TIMESTAMPTZ(6),
    "sla_due_at" TIMESTAMPTZ(6) NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "kyc_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cds_requests" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "investor_id" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "cds_account" VARCHAR(20),
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cds_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investors_reference_key" ON "investors"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "investors_account_id_key" ON "investors"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "investors_cds_account_key" ON "investors"("cds_account");

-- CreateIndex
CREATE INDEX "investors_status_idx" ON "investors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "individual_profiles_nida_number_key" ON "individual_profiles"("nida_number");

-- CreateIndex
CREATE UNIQUE INDEX "consents_investor_id_kind_version_key" ON "consents"("investor_id", "kind", "version");

-- CreateIndex
CREATE INDEX "verifications_investor_id_checked_at_idx" ON "verifications"("investor_id", "checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_cases_reference_key" ON "kyc_cases"("reference");

-- CreateIndex
CREATE INDEX "kyc_cases_status_opened_at_idx" ON "kyc_cases"("status", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "cds_requests_reference_key" ON "cds_requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "cds_requests_investor_id_key" ON "cds_requests"("investor_id");

-- CreateIndex
CREATE INDEX "cds_requests_status_created_at_idx" ON "cds_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "individual_profiles" ADD CONSTRAINT "individual_profiles_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cds_requests" ADD CONSTRAINT "cds_requests_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

