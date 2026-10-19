import "server-only";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { isTeleworkTitle } from "@/domain/calendar/classify";
import { extractHotelNights, type HotelNight } from "@/domain/calendar/hotels";
import { hasLocation, type LatLng } from "@/domain/geo";
import type { EstimateParams } from "@/domain/routing/estimate";
import { dayKeyOf, type DayKey } from "@/domain/time";
import type { DbOrTx } from "../db/client";
import { appointments, calendarEvents, pharmacies, pharmacyMetrics, travelPreferences } from "../db/schema";

export type AgendaVisit = {
  id: string;
  day: DayKey;
  start: Date;
  end: Date;
  pharmacyId: string;
  pharmacyName: string;
  city: string | null;
  departmentCode: string | null;
  category: string | null;
  location: LatLng | null;
  mode: "onsite" | "phone";
  modeReview: "none" | "pending" | "validated";
  modeReason: string | null;
};

export type AgendaData = {
  visits: AgendaVisit[];
  nights: HotelNight[];
  telework: { day: DayKey; start: Date; end: Date }[];
  home: LatLng | null;
  estimate: EstimateParams;
};

/**
 * Données de l'agenda utiles aux analyses : visites (rendez-vous rattachés à une
 * pharmacie), nuits d'hôtel et créneaux de télétravail lus dans les événements
 * importés, domicile et paramètres d'estimation des trajets.
 */
export async function loadAgendaData(db: DbOrTx, user: { id: string; timezone: string }, range?: { from: Date; to: Date }): Promise<AgendaData> {
  const rows = await db
    .select({
      a: {
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        mode: appointments.mode,
        modeReview: appointments.modeReview,
        modeReason: appointments.modeReason,
      },
      p: { id: pharmacies.id, name: pharmacies.name, city: pharmacies.city, departmentCode: pharmacies.departmentCode, lat: pharmacies.lat, lng: pharmacies.lng },
      category: pharmacyMetrics.category,
    })
    .from(appointments)
    .innerJoin(pharmacies, eq(pharmacies.id, appointments.pharmacyId))
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(
      and(
        eq(appointments.userId, user.id),
        eq(appointments.kind, "visit"),
        ne(appointments.status, "cancelled"),
        range ? gte(appointments.startsAt, range.from) : undefined,
        range ? lte(appointments.startsAt, range.to) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));

  const events = await db
    .select({ title: calendarEvents.title, location: calendarEvents.location, allDay: calendarEvents.allDay, start: calendarEvents.startsAt, end: calendarEvents.endsAt, isCancelled: calendarEvents.isCancelled })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, user.id),
        eq(calendarEvents.isCancelled, false),
        range ? gte(calendarEvents.endsAt, new Date(range.from.getTime() - 4 * 86_400_000)) : undefined,
        range ? lte(calendarEvents.startsAt, new Date(range.to.getTime() + 86_400_000)) : undefined,
      ),
    );
  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));

  return {
    visits: rows.map(({ a, p, category }) => ({
      id: a.id,
      day: dayKeyOf(a.startsAt, user.timezone),
      start: a.startsAt,
      end: a.endsAt,
      pharmacyId: p.id,
      pharmacyName: p.name,
      city: p.city,
      departmentCode: p.departmentCode,
      category: category ?? null,
      location: hasLocation(p) ? { lat: p.lat, lng: p.lng } : null,
      mode: a.mode,
      modeReview: a.modeReview,
      modeReason: a.modeReason,
    })),
    nights: extractHotelNights(events, user.timezone),
    telework: events
      .filter((e) => !e.allDay && isTeleworkTitle(e.title))
      .map((e) => ({ day: dayKeyOf(e.start, user.timezone), start: e.start, end: e.end })),
    home: travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null,
    estimate: { roadFactor: travel?.estimateRoadFactor ?? 1.25, speedKmh: travel?.estimateSpeedKmh ?? 90 },
  };
}
