ALTER TABLE "users" ADD COLUMN "onboarding_step" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gamification_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Les comptes existants ont déjà été configurés : pas de parcours d'accueil imposé.
UPDATE "users" SET "onboarding_completed_at" = now(), "onboarding_step" = 99 WHERE "onboarding_completed_at" IS NULL;
