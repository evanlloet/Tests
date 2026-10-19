CREATE TABLE "route_legs" (
	"provider" text NOT NULL,
	"from_key" text NOT NULL,
	"to_key" text NOT NULL,
	"distance_km" real NOT NULL,
	"duration_min" real NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_legs_provider_from_key_to_key_pk" PRIMARY KEY("provider","from_key","to_key")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "mode" text DEFAULT 'onsite' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "mode_review" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "mode_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_mode_check" CHECK ("appointments"."mode" in ('onsite', 'phone'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_mode_review_check" CHECK ("appointments"."mode_review" in ('none', 'pending', 'validated'));