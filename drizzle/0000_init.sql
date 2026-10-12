CREATE TABLE "appointment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_event_id" uuid NOT NULL,
	"pharmacy_id" uuid,
	"score" real DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_matches_status_check" CHECK ("appointment_matches"."status" in ('auto_validated', 'pending', 'validated', 'ignored', 'no_candidate')),
	CONSTRAINT "appointment_matches_score_check" CHECK ("appointment_matches"."score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pharmacy_id" uuid,
	"kind" text DEFAULT 'visit' NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"outcome" text DEFAULT 'unknown' NOT NULL,
	"completed_at" timestamp with time zone,
	"source" text NOT NULL,
	"calendar_event_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_check" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('proposed', 'pending', 'confirmed', 'cancelled')),
	CONSTRAINT "appointments_outcome_check" CHECK ("appointments"."outcome" in ('unknown', 'done', 'missed')),
	CONSTRAINT "appointments_kind_check" CHECK ("appointments"."kind" in ('visit', 'unavailable', 'other'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"last_seen_import_id" uuid,
	"source_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"uid" text,
	"recurrence_id" text,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"source_timezone" text,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"duplicate_of_id" uuid,
	"classification" text NOT NULL,
	"classification_reason" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"file_sha256" text NOT NULL,
	"status" text NOT NULL,
	"total_events" integer DEFAULT 0 NOT NULL,
	"new_events" integer DEFAULT 0 NOT NULL,
	"updated_events" integer DEFAULT 0 NOT NULL,
	"unchanged_events" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"price_note" text,
	"url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"related" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"external_id" text,
	"external_source" text,
	"address_line" text,
	"postal_code" text,
	"city" text,
	"department_code" text,
	"phone" text,
	"lat" double precision,
	"lng" double precision,
	"geo_precision" text,
	"geo_source" text,
	"status" text DEFAULT 'active' NOT NULL,
	"dedupe_key" text NOT NULL,
	"normalized_name" text NOT NULL,
	"source" text NOT NULL,
	"source_import_id" uuid,
	"source_updated_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"source" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_metrics" (
	"pharmacy_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text,
	"annual_revenue" numeric(14, 2),
	"potential" text,
	"size" text,
	"target_visits_per_year" smallint,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_metrics_category_check" CHECK ("pharmacy_metrics"."category" in ('A', 'B', 'C', 'D')),
	CONSTRAINT "pharmacy_metrics_target_check" CHECK ("pharmacy_metrics"."target_visits_per_year" between 1 and 52),
	CONSTRAINT "pharmacy_metrics_revenue_check" CHECK ("pharmacy_metrics"."annual_revenue" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_preferences" (
	"pharmacy_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"preferred_weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"excluded_weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"preferred_start" time,
	"preferred_end" time,
	"visit_minutes" smallint,
	"constraints" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider" text NOT NULL,
	"total_distance_km" real NOT NULL,
	"total_drive_minutes" real NOT NULL,
	"visit_count" smallint NOT NULL,
	"metrics" jsonb NOT NULL,
	"explanation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compared_to_plan_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"route_plan_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"kind" text NOT NULL,
	"appointment_id" uuid,
	"pharmacy_id" uuid,
	"label" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"arrival_at" timestamp with time zone,
	"departure_at" timestamp with time zone,
	"leg_distance_km" real,
	"leg_drive_minutes" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"home_label" text DEFAULT 'Domicile' NOT NULL,
	"home_address" text,
	"home_lat" double precision,
	"home_lng" double precision,
	"max_daily_drive_minutes" smallint DEFAULT 300 NOT NULL,
	"hotel_threshold_km" smallint DEFAULT 150 NOT NULL,
	"must_return_home_weekdays" smallint[] DEFAULT '{5}'::smallint[] NOT NULL,
	"estimate_speed_kmh" smallint DEFAULT 90 NOT NULL,
	"estimate_road_factor" real DEFAULT 1.25 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"work_day_start" time DEFAULT '08:30' NOT NULL,
	"work_day_end" time DEFAULT '18:30' NOT NULL,
	"default_visit_minutes" smallint DEFAULT 45 NOT NULL,
	"buffer_minutes" smallint DEFAULT 10 NOT NULL,
	"lunch_start" time DEFAULT '12:30' NOT NULL,
	"lunch_minutes" smallint DEFAULT 60 NOT NULL,
	"frequency_a" smallint DEFAULT 4 NOT NULL,
	"frequency_b" smallint DEFAULT 4 NOT NULL,
	"frequency_c" smallint DEFAULT 4 NOT NULL,
	"frequency_d" smallint DEFAULT 3 NOT NULL,
	"auto_match_threshold" real DEFAULT 0.9 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"appointment_id" uuid,
	"pharmacy_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"next_actions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_template_assignments" (
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_template_assignments_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "weekly_preference_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"territory_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_prefs_weekday_check" CHECK ("weekly_preferences"."weekday" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "appointment_matches" ADD CONSTRAINT "appointment_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_matches" ADD CONSTRAINT "appointment_matches_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_matches" ADD CONSTRAINT "appointment_matches_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_import_id_calendar_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."calendar_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_last_seen_import_id_calendar_imports_id_fk" FOREIGN KEY ("last_seen_import_id") REFERENCES "public"."calendar_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_imports" ADD CONSTRAINT "calendar_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_places" ADD CONSTRAINT "favorite_places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_imports" ADD CONSTRAINT "pharmacy_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_metrics" ADD CONSTRAINT "pharmacy_metrics_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_metrics" ADD CONSTRAINT "pharmacy_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_preferences" ADD CONSTRAINT "pharmacy_preferences_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_preferences" ADD CONSTRAINT "pharmacy_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_plan_id_route_plans_id_fk" FOREIGN KEY ("route_plan_id") REFERENCES "public"."route_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territories" ADD CONSTRAINT "territories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_preferences" ADD CONSTRAINT "travel_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reports" ADD CONSTRAINT "visit_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reports" ADD CONSTRAINT "visit_reports_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reports" ADD CONSTRAINT "visit_reports_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_assignments" ADD CONSTRAINT "week_template_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_assignments" ADD CONSTRAINT "week_template_assignments_template_id_weekly_preference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."weekly_preference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_preference_templates" ADD CONSTRAINT "weekly_preference_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_preferences" ADD CONSTRAINT "weekly_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_preferences" ADD CONSTRAINT "weekly_preferences_template_id_weekly_preference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."weekly_preference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_preferences" ADD CONSTRAINT "weekly_preferences_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_matches_event_key" ON "appointment_matches" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "appointment_matches_user_status_idx" ON "appointment_matches" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "appointments_user_start_idx" ON "appointments" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_pharmacy_idx" ON "appointments" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_calendar_event_key" ON "appointments" USING btree ("calendar_event_id") WHERE "appointments"."calendar_event_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_logs_user_entity_idx" ON "audit_logs" USING btree ("user_id","entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_user_source_key" ON "calendar_events" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "calendar_events_user_start_idx" ON "calendar_events" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacies_user_dedupe_key" ON "pharmacies" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacies_user_external_key" ON "pharmacies" USING btree ("user_id","external_source","external_id") WHERE "pharmacies"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "pharmacies_user_department_idx" ON "pharmacies" USING btree ("user_id","department_code");--> statement-breakpoint
CREATE INDEX "route_plans_user_date_idx" ON "route_plans" USING btree ("user_id","plan_date");--> statement-breakpoint
CREATE UNIQUE INDEX "route_stops_plan_seq_key" ON "route_stops" USING btree ("route_plan_id","seq");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "territories_user_kind_code_key" ON "territories" USING btree ("user_id","kind","code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "visit_reports_pharmacy_idx" ON "visit_reports" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_templates_user_name_key" ON "weekly_preference_templates" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_prefs_template_day_territory_key" ON "weekly_preferences" USING btree ("template_id","weekday","territory_id");