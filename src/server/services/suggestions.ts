import "server-only";
import { eq } from "drizzle-orm";
import { targetVisitsPerYear, type VisitStatus } from "@/domain/frequency";
import { hasLocation } from "@/domain/geo";
import { suggestSlots, type DayPlan, type SlotSuggestion } from "@/domain/scheduling/suggest";
import { addDays, dayKeyOf, minutesOfDay, parseHHmm, zonedDateTime, type DayKey } from "@/domain/time";
import { createEstimateProvider } from "@/domain/routing/estimate";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { travelPreferences } from "../db/schema";
import { getPharmacy, visitAggregates } from "../repositories/pharmacies";
import { preferredDepartmentsByDay, territoryLookup } from "../repositories/territories";
import { listAppointmentsInRange } from "./appointments";
import { frequencySettings, todayFor, yearBounds } from "./context";
import { statusFromAggregate } from "./pharmacy-overview";

export type NextVisitSuggestions = {
  status: VisitStatus;
  targetDay: DayKey | null;
  suggestions: SlotSuggestion[];
  /** Pourquoi aucune proposition n'est calculée */
  blocker: string | null;
  disclaimer: string | null;
};

export async function suggestNextVisit(db: Db, user: SessionUser, pharmacyId: string): Promise<NextVisitSuggestions | null> {
  const row = await getPharmacy(db, user.id, pharmacyId);
  if (!row) return null;
  const now = new Date();
  const today = todayFor(user, now);
  const { yearStart, nextYearStart } = yearBounds(today, user.timezone);
  const agg = (await visitAggregates(db, user.id, now, yearStart, nextYearStart, [pharmacyId])).get(pharmacyId);
  const target = targetVisitsPerYear(row.metrics?.category ?? null, row.metrics?.targetVisitsPerYear ?? null, frequencySettings(user));
  const status = statusFromAggregate(agg, target.perYear, today, user.timezone);

  if (!status.nextDue) {
    return {
      status,
      targetDay: null,
      suggestions: [],
      blocker: "Catégorie et fréquence inconnues : renseignez-les sur la fiche pour calculer la prochaine échéance.",
      disclaimer: null,
    };
  }
  if (!hasLocation(row.pharmacy)) {
    return {
      status,
      targetDay: status.nextDue,
      suggestions: [],
      blocker: "La pharmacie n'a pas de coordonnées : impossible d'évaluer les trajets. Géolocalisez la fiche.",
      disclaimer: null,
    };
  }

  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));
  const estimate = { roadFactor: travel?.estimateRoadFactor ?? 1.25, speedKmh: travel?.estimateSpeedKmh ?? 90 };
  const targetDay = status.nextDue < addDays(today, 1) ? addDays(today, 1) : status.nextDue;
  const from = addDays(targetDay, -21) > today ? addDays(targetDay, -21) : addDays(today, 1);
  const to = addDays(targetDay, 35);

  const appts = await listAppointmentsInRange(
    db,
    user.id,
    zonedDateTime(from, "00:00", user.timezone),
    zonedDateTime(addDays(to, 1), "00:00", user.timezone),
  );
  const prefs = await preferredDepartmentsByDay(db, user.id, from, to);
  const days = new Map<DayKey, DayPlan>();
  for (const [day, p] of prefs) days.set(day, { appointments: [], preferredDepartments: p.departments });
  for (const a of appts) {
    const day = dayKeyOf(a.appointment.startsAt, user.timezone);
    const plan = days.get(day);
    if (!plan) continue;
    plan.appointments.push({
      id: a.appointment.id,
      label: a.pharmacy?.name ?? a.appointment.title,
      start: minutesOfDay(a.appointment.startsAt, user.timezone),
      end: minutesOfDay(a.appointment.endsAt, user.timezone),
      location: a.pharmacy && hasLocation(a.pharmacy) ? { lat: a.pharmacy.lat, lng: a.pharmacy.lng } : null,
      departmentCode: a.pharmacy?.departmentCode ?? null,
      kind: a.appointment.kind,
    });
  }
  const territories = await territoryLookup(db, user.id);
  const prefsRow = row.preferences;
  const suggestions = suggestSlots({
    target: {
      id: row.pharmacy.id,
      label: row.pharmacy.name,
      location: { lat: row.pharmacy.lat!, lng: row.pharmacy.lng! },
      departmentCode: row.pharmacy.departmentCode,
      category: row.metrics?.category ?? null,
      preferredWeekdays: prefsRow?.preferredWeekdays ?? [],
      excludedWeekdays: prefsRow?.excludedWeekdays ?? [],
      preferredStart: prefsRow?.preferredStart ? parseHHmm(prefsRow.preferredStart) : null,
      preferredEnd: prefsRow?.preferredEnd ? parseHHmm(prefsRow.preferredEnd) : null,
      visitMinutes: prefsRow?.visitMinutes ?? null,
    },
    targetDay,
    today,
    days,
    settings: {
      workStart: parseHHmm(user.workDayStart),
      workEnd: parseHHmm(user.workDayEnd),
      lunchStart: parseHHmm(user.lunchStart),
      lunchMinutes: user.lunchMinutes,
      bufferMinutes: user.bufferMinutes,
      defaultVisitMinutes: user.defaultVisitMinutes,
      home: travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null,
      hotelThresholdKm: travel?.hotelThresholdKm ?? 150,
      mustReturnHomeWeekdays: travel?.mustReturnHomeWeekdays ?? [5],
      estimate,
    },
    departmentNames: Object.fromEntries([...territories].map(([code, t]) => [code, t.name])),
  });
  return {
    status,
    targetDay,
    suggestions,
    blocker: suggestions.length ? null : "Aucun créneau compatible trouvé autour de l'échéance (planning complet ou contraintes trop fortes).",
    disclaimer: createEstimateProvider(estimate).info.disclaimer,
  };
}
