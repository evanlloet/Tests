ALTER TABLE "pharmacies" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "sales_zone" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "buying_group" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "targeting" text[];--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "extra" jsonb;--> statement-breakpoint
ALTER TABLE "pharmacy_metrics" ADD COLUMN "revenue_previous_year" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pharmacy_metrics" ADD COLUMN "revenue_current_year" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pharmacy_metrics" ADD COLUMN "last_order_on" date;--> statement-breakpoint
ALTER TABLE "pharmacy_metrics" ADD COLUMN "planned_visit_on" date;--> statement-breakpoint
CREATE INDEX "pharmacies_user_sales_zone_idx" ON "pharmacies" USING btree ("user_id","sales_zone");