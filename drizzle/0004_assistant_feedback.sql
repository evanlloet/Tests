CREATE TABLE "assistant_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"day" date,
	"weekday" smallint,
	"department_code" text,
	"pharmacy_id" uuid,
	"reason" text NOT NULL,
	"until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_feedback_user_idx" ON "assistant_feedback" USING btree ("user_id","created_at");