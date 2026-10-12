import "server-only";
import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { analyzeHistory, type HistoryAnalysis } from "@/domain/analytics/history";
import { hasLocation } from "@/domain/geo";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { appointments, calendarEvents, pharmacies, pharmacyMetrics, travelPreferences } from "../db/schema";
import { matchCounts } from "../repositories/matches";

export type DataQuality = {
  pharmacies: number;
  geolocated: number;
  categorized: number;
  importedEvents: number;
  matches: Awaited<ReturnType<typeof matchCounts>>;
};

export async function getHistoryAnalysis(db: Db, user: SessionUser): Promise<{ analysis: HistoryAnalysis; quality: DataQuality }> {
  const now = new Date();
  const rows = await db
    .select({ appointment: appointments, pharmacy: pharmacies })
    .from(appointments)
    .innerJoin(pharmacies, eq(pharmacies.id, appointments.pharmacyId))
    .where(
      and(
        eq(appointments.userId, user.id),
        eq(appointments.kind, "visit"),
        ne(appointments.status, "cancelled"),
        lt(appointments.startsAt, now),
        or(eq(appointments.outcome, "done"), sql`${appointments.status} in ('confirmed', 'pending')`),
      ),
    );
  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));
  const analysis = analyzeHistory({
    visits: rows.map(({ appointment: a, pharmacy: p }) => ({
      id: a.id,
      pharmacyId: p.id,
      pharmacyName: p.name,
      departmentCode: p.departmentCode,
      location: hasLocation(p) ? { lat: p.lat, lng: p.lng } : null,
      start: a.startsAt,
      end: a.endsAt,
      outcome: a.outcome,
    })),
    tz: user.timezone,
    home: travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null,
    hotelThresholdKm: travel?.hotelThresholdKm ?? 150,
    estimate: { roadFactor: travel?.estimateRoadFactor ?? 1.25, speedKmh: travel?.estimateSpeedKmh ?? 90 },
  });

  const [q] = await db
    .select({
      total: sql<number>`count(*)::int`,
      geolocated: sql<number>`count(*) filter (where ${pharmacies.lat} is not null)::int`,
      categorized: sql<number>`count(${pharmacyMetrics.category})::int`,
    })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(eq(pharmacies.userId, user.id));
  const [ev] = await db.select({ n: sql<number>`count(*)::int` }).from(calendarEvents).where(eq(calendarEvents.userId, user.id));
  return {
    analysis,
    quality: {
      pharmacies: q?.total ?? 0,
      geolocated: q?.geolocated ?? 0,
      categorized: q?.categorized ?? 0,
      importedEvents: ev?.n ?? 0,
      matches: await matchCounts(db, user.id),
    },
  };
}
