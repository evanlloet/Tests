import "server-only";
import { eq } from "drizzle-orm";
import { hasLocation, type LatLng } from "@/domain/geo";
import { dayMood, type DayMoodKey, type LoadLevel, type MoodVisual } from "@/domain/mood";
import { publicHolidayName } from "@/domain/holidays";
import { estimateLeg } from "@/domain/routing/estimate";
import { addDays, dayKeyOf, isoWeekday, minutesOfDay, parseHHmm, zonedDateTime, type DayKey } from "@/domain/time";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { travelPreferences, type Appointment } from "../db/schema";
import { preferredDepartmentsByDay, territoryLookup } from "../repositories/territories";
import { listAppointmentsInRange } from "./appointments";

export type PlanningAppointment = {
  id: string;
  title: string;
  kind: Appointment["kind"];
  mode: Appointment["mode"];
  status: Appointment["status"];
  outcome: Appointment["outcome"];
  source: Appointment["source"];
  start: number;
  end: number;
  startIso: string;
  pharmacy: { id: string; name: string; city: string | null; departmentCode: string | null; lat: number | null; lng: number | null } | null;
  category: string | null;
  color: string | null;
  overlaps: boolean;
};

export type { LoadLevel } from "@/domain/mood";

export type PlanningDay = {
  day: DayKey;
  weekday: number;
  holiday: string | null;
  templateName: string | null;
  sectors: { code: string; name: string; color: string }[];
  appointments: PlanningAppointment[];
  visits: number;
  visitMinutes: number;
  /** Conduite estimée (domicile → visites → domicile), null si coordonnées manquantes */
  driveMinutes: number | null;
  driveKm: number | null;
  load: LoadLevel;
  warnings: string[];
  mood: MoodVisual & { key: DayMoodKey };
  /** Toutes les visites passées de la journée sont clôturées (réalisées ou non) */
  allClosed: boolean;
};

export async function getPlanning(db: Db, user: SessionUser, from: DayKey, to: DayKey): Promise<PlanningDay[]> {
  const appts = await listAppointmentsInRange(
    db,
    user.id,
    zonedDateTime(from, "00:00", user.timezone),
    zonedDateTime(addDays(to, 1), "00:00", user.timezone),
  );
  const prefs = await preferredDepartmentsByDay(db, user.id, from, to);
  const territories = await territoryLookup(db, user.id);
  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));
  const home: LatLng | null = travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null;
  const estimate = { roadFactor: travel?.estimateRoadFactor ?? 1.25, speedKmh: travel?.estimateSpeedKmh ?? 90 };
  const workSpan = parseHHmm(user.workDayEnd) - parseHHmm(user.workDayStart);

  const days: PlanningDay[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const pref = prefs.get(day);
    const list: PlanningAppointment[] = appts
      .filter((a) => dayKeyOf(a.appointment.startsAt, user.timezone) === day)
      .map((a) => ({
        id: a.appointment.id,
        title: a.pharmacy?.name ?? a.appointment.title,
        kind: a.appointment.kind,
        mode: a.appointment.mode,
        status: a.appointment.status,
        outcome: a.appointment.outcome,
        source: a.appointment.source,
        start: minutesOfDay(a.appointment.startsAt, user.timezone),
        end: Math.max(minutesOfDay(a.appointment.endsAt, user.timezone), minutesOfDay(a.appointment.startsAt, user.timezone) + 15),
        startIso: a.appointment.startsAt.toISOString(),
        pharmacy: a.pharmacy,
        category: a.category,
        color: a.pharmacy?.departmentCode ? (territories.get(a.pharmacy.departmentCode)?.color ?? null) : null,
        overlaps: false,
      }));
    for (const a of list) {
      a.overlaps = list.some((b) => b !== a && b.start < a.end && b.end > a.start);
    }
    const visits = list.filter((a) => a.kind === "visit");
    const visitMinutes = visits.reduce((n, a) => n + (a.end - a.start), 0);
    let driveMinutes: number | null = null;
    let driveKm: number | null = null;
    // Les rendez-vous téléphoniques ne génèrent pas de trajet
    const onsite = visits.filter((a) => a.mode !== "phone");
    const located = onsite.filter((a) => a.pharmacy && hasLocation(a.pharmacy));
    if (home && onsite.length > 0 && located.length === onsite.length) {
      driveMinutes = 0;
      driveKm = 0;
      let pos = home;
      for (const v of located) {
        const loc = { lat: v.pharmacy!.lat!, lng: v.pharmacy!.lng! };
        const leg = estimateLeg(pos, loc, estimate);
        driveMinutes += leg.minutes;
        driveKm += leg.km;
        pos = loc;
      }
      const back = estimateLeg(pos, home, estimate);
      driveMinutes += back.minutes;
      driveKm += back.km;
    }
    const used = visitMinutes + (driveMinutes ?? 0) + (visits.length ? user.lunchMinutes : 0);
    const ratio = workSpan > 0 ? used / workSpan : 0;
    const load: LoadLevel = visits.length === 0 ? "vide" : ratio < 0.5 ? "légère" : ratio < 0.8 ? "équilibrée" : ratio <= 1 ? "chargée" : "trop chargée";
    const warnings: string[] = [];
    if (list.some((a) => a.overlaps)) warnings.push("Rendez-vous qui se chevauchent");
    if (load === "trop chargée") warnings.push("Journée irréaliste (visites + trajets > amplitude)");
    const holiday = publicHolidayName(day);
    if (holiday && visits.length) warnings.push(`Jour férié (${holiday})`);
    const sectorCodes = new Set(pref?.departments ?? []);
    const offSector = onsite.filter((v) => v.pharmacy?.departmentCode && sectorCodes.size && !sectorCodes.has(v.pharmacy.departmentCode));
    if (offSector.length) warnings.push(`${offSector.length} visite(s) hors du secteur prévu`);

    const overlaps = list.some((a) => a.overlaps);
    days.push({
      mood: dayMood({ load, weekday: isoWeekday(day), holiday, visits: visits.length, overlaps }),
      allClosed: visits.length > 0 && visits.every((v) => v.outcome !== "unknown"),
      day,
      weekday: isoWeekday(day),
      holiday,
      templateName: pref?.templateName ?? null,
      sectors: (pref?.departments ?? []).map((code) => ({ code, name: territories.get(code)?.name ?? code, color: territories.get(code)?.color ?? "#888" })),
      appointments: list,
      visits: visits.length,
      visitMinutes,
      driveMinutes,
      driveKm,
      load,
      warnings,
    });
  }
  return days;
}
