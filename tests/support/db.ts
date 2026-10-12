import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@/server/db/create";
import { createUserWithDefaults } from "@/server/repositories/users";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://lea:lea@localhost:5432/lea_test";

export const testDb = createDb(TEST_DATABASE_URL);

let migrated = false;

/** Base de test vierge, migrée, avec un utilisateur créé selon la configuration par défaut. */
export async function resetDatabase() {
  if (!migrated) {
    await migrate(testDb, { migrationsFolder: "drizzle" });
    migrated = true;
  }
  await testDb.execute(sql`
    truncate table audit_logs, notifications, favorite_places, route_stops, route_plans, visit_reports,
      appointment_matches, appointments, calendar_events, calendar_imports, pharmacy_preferences,
      pharmacy_metrics, pharmacy_imports, pharmacies, week_template_assignments, weekly_preferences,
      weekly_preference_templates, territories, travel_preferences, sessions, users cascade
  `);
}

export async function createTestUser(email = "lea@example.test") {
  const id = await testDb.transaction((tx) =>
    createUserWithDefaults(tx, { email, passwordHash: "scrypt$test", displayName: "Test" }),
  );
  return { id, timezone: "Europe/Paris", autoMatchThreshold: 0.9, defaultVisitMinutes: 45 };
}

export const bytes = (text: string) => new TextEncoder().encode(text);
