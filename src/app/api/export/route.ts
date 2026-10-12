import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import * as t from "@/server/db/schema";

export const dynamic = "force-dynamic";

/** Export de toutes les données de l'utilisatrice (portabilité, sauvegarde personnelle). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const id = user.id;
  const [account] = await db.select().from(t.users).where(eq(t.users.id, id));
  const { passwordHash: _hash, ...profile } = account!;
  const data = {
    exportedAt: new Date().toISOString(),
    format: "lea-export-v1",
    profile,
    travelPreferences: await db.select().from(t.travelPreferences).where(eq(t.travelPreferences.userId, id)),
    territories: await db.select().from(t.territories).where(eq(t.territories.userId, id)),
    weeklyPreferenceTemplates: await db.select().from(t.weeklyPreferenceTemplates).where(eq(t.weeklyPreferenceTemplates.userId, id)),
    weeklyPreferences: await db.select().from(t.weeklyPreferences).where(eq(t.weeklyPreferences.userId, id)),
    weekTemplateAssignments: await db.select().from(t.weekTemplateAssignments).where(eq(t.weekTemplateAssignments.userId, id)),
    pharmacies: await db.select().from(t.pharmacies).where(eq(t.pharmacies.userId, id)),
    pharmacyMetrics: await db.select().from(t.pharmacyMetrics).where(eq(t.pharmacyMetrics.userId, id)),
    pharmacyPreferences: await db.select().from(t.pharmacyPreferences).where(eq(t.pharmacyPreferences.userId, id)),
    pharmacyImports: await db.select().from(t.pharmacyImports).where(eq(t.pharmacyImports.userId, id)),
    appointments: await db.select().from(t.appointments).where(eq(t.appointments.userId, id)),
    visitReports: await db.select().from(t.visitReports).where(eq(t.visitReports.userId, id)),
    calendarImports: await db.select().from(t.calendarImports).where(eq(t.calendarImports.userId, id)),
    calendarEvents: await db.select().from(t.calendarEvents).where(eq(t.calendarEvents.userId, id)),
    appointmentMatches: await db.select().from(t.appointmentMatches).where(eq(t.appointmentMatches.userId, id)),
    routePlans: await db.select().from(t.routePlans).where(eq(t.routePlans.userId, id)),
    routeStops: await db.select().from(t.routeStops).where(eq(t.routeStops.userId, id)),
    favoritePlaces: await db.select().from(t.favoritePlaces).where(eq(t.favoritePlaces.userId, id)),
    notifications: await db.select().from(t.notifications).where(eq(t.notifications.userId, id)),
    auditLogs: await db.select().from(t.auditLogs).where(eq(t.auditLogs.userId, id)),
  };
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="lea-export-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
