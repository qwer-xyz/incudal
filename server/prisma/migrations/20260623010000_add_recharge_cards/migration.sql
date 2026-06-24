-- Add recharge card payment provider type and recharge card table.

ALTER TYPE "PaymentProviderType" ADD VALUE IF NOT EXISTS 'recharge_card';

CREATE TABLE "recharge_cards" (
    "id" SERIAL NOT NULL,
    "card_no" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "batch_no" TEXT NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_by_id" INTEGER,
    "used_at" TIMESTAMP(3),
    "recharge_record_id" INTEGER,

    CONSTRAINT "recharge_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recharge_cards_card_no_key" ON "recharge_cards"("card_no");
CREATE UNIQUE INDEX "recharge_cards_recharge_record_id_key" ON "recharge_cards"("recharge_record_id");
CREATE INDEX "recharge_cards_batch_no_idx" ON "recharge_cards"("batch_no");
CREATE INDEX "recharge_cards_created_by_id_idx" ON "recharge_cards"("created_by_id");
CREATE INDEX "recharge_cards_used_by_id_idx" ON "recharge_cards"("used_by_id");
CREATE INDEX "recharge_cards_used_at_idx" ON "recharge_cards"("used_at");
CREATE INDEX "recharge_cards_created_at_idx" ON "recharge_cards"("created_at");

ALTER TABLE "recharge_cards"
  ADD CONSTRAINT "recharge_cards_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recharge_cards"
  ADD CONSTRAINT "recharge_cards_used_by_id_fkey"
  FOREIGN KEY ("used_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recharge_cards"
  ADD CONSTRAINT "recharge_cards_recharge_record_id_fkey"
  FOREIGN KEY ("recharge_record_id") REFERENCES "recharge_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
