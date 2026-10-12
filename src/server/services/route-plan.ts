import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { categoryWeight } from "@/domain/frequency";
import { haversineKm, hasLocation, type LatLng } from "@/domain/geo";
import { compareScenarios, optimizeDay, type ScenarioComparison } from "@/domain/routing/optimizer";
import { simulateDay, type DayContext, type PlanStop, type ScheduleResult } from "@/domain/routing/schedule";
import type { TravelMatrix, TravelProviderInfo } from "@/domain/routing/types";
import { bestSlotInDay } from "@/domain/scheduling/suggest";
import { addDays, minutesOfDay, parseHHmm, zonedDateTime, type DayKey } from "@/domain/time";
import { computeTravel } from "@/integrations/routing";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { appointments, favoritePlaces, pharmacyPreferences, routePlans, routeStops, travelPreferences } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { listAppointmentsInRange, type AppointmentWithPharmacy } from "./appointments";
import { getPharmacyOverview } from "./pharmacy-overview";

export class RoutePlanError extends Error {}

export type Endpoint = { kind: "home" } | { kind: "place"; id: string };

export type RoutePoint = LatLng & { label: string; kind: "start" | "end" | "visit" };

export type DaySimulation = {
  day: DayKey;
  provider: TravelProviderInfo;
  fallbackReason: string | null;
  warnings: string[];
  start: { label: string; location: LatLng | null };
  end: { label: string; location: LatLng | null };
  /** Visites sans coordonnées : exclues du calcul */
  unlocated: AppointmentWithPharmacy[];
  stops: Record<string, AppointmentWithPharmacy>;
  initial: ScheduleResult;
  optimized: ScheduleResult;
  comparison: ScenarioComparison;
  method: string;
  evaluated: number;
  points: (LatLng | null)[];
  /** Identifiants des scénarios enregistrés */
  currentPlanId: string | null;
  optimizedPlanId: string | null;
  nearby: NearbySuggestion[];
  /** Mode « rendez-vous confirmés déplaçables » */
  allowConfirmed: boolean;
  /** Rendez-vous confirmés que le scénario optimisé déplacerait (à renégocier) */
  movedConfirmed: { id: string; label: string; from: number; to: number }[];
};

export type NearbySuggestion = {
  pharmacyId: string;
  name: string;
  city: string | null;
  category: string | null;
  dueLabel: string;
  detourKm: number;
  start: number | null;
  location: LatLng;
};

function dayContext(user: SessionUser, maxDriveMinutes: number): DayContext {
  return {
    workStart: parseHHmm(user.workDayStart),
    workEnd: parseHHmm(user.workDayEnd),
    lunchStart: parseHHmm(user.lunchStart),
    lunchMinutes: user.lunchMinutes,
    lunchFlexMinutes: 60,
    bufferMinutes: user.bufferMinutes,
    maxDriveMinutes,
  };
}

/** Ajoute un point « virtuel » à distance nulle (domicile non renseigné). */
function withVirtualNode(m: TravelMatrix): TravelMatrix {
  const n = m.distancesKm.length;
  const grow = (rows: number[][]) => [...rows.map((r) => [...r, 0]), new Array<number>(n + 1).fill(0)];
  return { distancesKm: grow(m.distancesKm), durationsMin: grow(m.durationsMin) };
}

export async function simulateDayPlan(
  db: Db,
  user: SessionUser,
  day: DayKey,
  options: { start?: Endpoint; end?: Endpoint; persist?: boolean; allowConfirmed?: boolean } = {},
): Promise<DaySimulation | null> {
  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));
  const estimate = { roadFactor: travel?.estimateRoadFactor ?? 1.25, speedKmh: travel?.estimateSpeedKmh ?? 90 };
  const home = travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null;
  const warnings: string[] = [];

  const resolveEndpoint = async (ep: Endpoint | undefined) => {
    if (!ep || ep.kind === "home") return { label: travel?.homeLabel ?? "Domicile", location: home };
    const [place] = await db
      .select()
      .from(favoritePlaces)
      .where(and(eq(favoritePlaces.id, ep.id), eq(favoritePlaces.userId, user.id)));
    if (!place) throw new RoutePlanError("Lieu de départ ou d'arrivée introuvable.");
    return { label: place.name, location: hasLocation(place) ? { lat: place.lat, lng: place.lng } : null };
  };
  const start = await resolveEndpoint(options.start);
  const end = await resolveEndpoint(options.end);
  if (!start.location || !end.location) {
    warnings.push("Point de départ ou d'arrivée sans coordonnées : les trajets depuis et vers ce point ne sont pas comptés. Renseignez le domicile dans le profil.");
  }

  const from = zonedDateTime(day, "00:00", user.timezone);
  const to = zonedDateTime(addDays(day, 1), "00:00", user.timezone);
  const all = await listAppointmentsInRange(db, user.id, from, to);
  const visits = all.filter((a) => a.appointment.kind === "visit" && a.pharmacy);
  if (visits.length === 0) return null;
  if (all.some((a) => a.appointment.kind === "unavailable")) {
    warnings.push("Une indisponibilité est prévue ce jour-là : elle n'est pas prise en compte par l'optimisation, vérifiez les horaires proposés.");
  }
  const located = visits.filter((a) => hasLocation(a.pharmacy!));
  const unlocated = visits.filter((a) => !hasLocation(a.pharmacy!));
  if (unlocated.length) warnings.push(`${unlocated.length} visite(s) sans coordonnées exclue(s) du calcul.`);
  if (located.length === 0) throw new RoutePlanError("Aucune visite géolocalisée ce jour-là : impossible de calculer une tournée.");

  const prefs = await db
    .select()
    .from(pharmacyPreferences)
    .where(and(eq(pharmacyPreferences.userId, user.id), inArray(pharmacyPreferences.pharmacyId, located.map((a) => a.pharmacy!.id))));
  const prefsById = new Map(prefs.map((p) => [p.pharmacyId, p]));

  // Points : visites, puis départ, puis arrivée
  const points: (LatLng | null)[] = [...located.map((a) => ({ lat: a.pharmacy!.lat!, lng: a.pharmacy!.lng! })), start.location, end.location];
  const realPoints = points.filter((p): p is LatLng => p !== null);
  const travelRes = await computeTravel(realPoints, estimate);
  let matrix = travelRes.matrix;
  // Réindexe si départ/arrivée sans coordonnées (nœud virtuel à distance nulle)
  let startIndex = located.length;
  let endIndex = located.length + 1;
  if (!start.location || !end.location) {
    matrix = withVirtualNode(matrix);
    const virtual = matrix.distancesKm.length - 1;
    let idx = located.length;
    startIndex = start.location ? idx++ : virtual;
    endIndex = end.location ? idx : virtual;
  }

  const stops: PlanStop[] = located.map((a, i) => {
    const pref = prefsById.get(a.pharmacy!.id);
    // En mode « confirmés déplaçables », plus aucun horaire n'est figé (la simulation le signale)
    const confirmed = a.appointment.status === "confirmed" && !options.allowConfirmed;
    return {
      id: a.appointment.id,
      label: a.pharmacy!.name,
      pointIndex: i,
      durationMin: Math.round((a.appointment.endsAt.getTime() - a.appointment.startsAt.getTime()) / 60_000),
      fixedStart: confirmed ? minutesOfDay(a.appointment.startsAt, user.timezone) : null,
      earliest: !confirmed && pref?.preferredStart ? parseHHmm(pref.preferredStart) : null,
      latest: pref?.preferredEnd ? parseHHmm(pref.preferredEnd) : null,
    };
  });
  // Ordre actuel = ordre chronologique ; les horaires actuels servent de point de départ
  const ctx = dayContext(user, travel?.maxDailyDriveMinutes ?? 300);
  const currentStops = stops.map((s, i) => ({
    ...s,
    earliest: s.fixedStart === null ? Math.max(s.earliest ?? 0, minutesOfDay(located[i]!.appointment.startsAt, user.timezone)) : s.earliest,
  }));
  const initial = simulateDay({ ctx, stops: currentStops, startIndex, endIndex, matrix });
  const best = optimizeDay({ ctx, stops, startIndex, endIndex, matrix });
  const comparison = compareScenarios(initial, best.schedule);
  if (!travelRes.provider.isRealRouting && travelRes.provider.disclaimer) comparison.explanation.push(travelRes.provider.disclaimer);

  const byId = Object.fromEntries(located.map((a) => [a.appointment.id, a]));
  let currentPlanId: string | null = null;
  let optimizedPlanId: string | null = null;
  if (options.persist !== false) {
    [currentPlanId, optimizedPlanId] = await db.transaction(async (tx) => {
      const save = async (kind: "current" | "optimized", schedule: ScheduleResult, comparedTo: string | null) => {
        const [plan] = await tx
          .insert(routePlans)
          .values({
            userId: user.id,
            planDate: day,
            kind,
            provider: travelRes.provider.id,
            totalDistanceKm: schedule.totalKm,
            totalDriveMinutes: schedule.totalDriveMin,
            visitCount: schedule.stops.length,
            metrics: {
              returnAt: schedule.returnLeg.arrival,
              departure: schedule.departure,
              waitMinutes: schedule.totalWaitMin,
              violations: schedule.violations,
              lunch: schedule.lunch,
              start: start.label,
              allowConfirmed: Boolean(options.allowConfirmed),
              end: end.label,
            },
            explanation: kind === "optimized" ? comparison.explanation : [],
            comparedToPlanId: comparedTo,
          })
          .returning({ id: routePlans.id });
        const toDate = (m: number) => zonedDateTime(day, "00:00", user.timezone).getTime() + m * 60_000;
        await tx.insert(routeStops).values([
          { userId: user.id, routePlanId: plan!.id, seq: 0, kind: "start" as const, label: start.label, lat: start.location?.lat, lng: start.location?.lng, departureAt: new Date(toDate(schedule.departure)) },
          ...schedule.stops.map((s, i) => ({
            userId: user.id,
            routePlanId: plan!.id,
            seq: i + 1,
            kind: "visit" as const,
            appointmentId: s.id,
            pharmacyId: byId[s.id]!.pharmacy!.id,
            label: s.label,
            lat: byId[s.id]!.pharmacy!.lat,
            lng: byId[s.id]!.pharmacy!.lng,
            arrivalAt: new Date(toDate(s.arrival)),
            visitStartAt: new Date(toDate(s.start)),
            visitEndAt: new Date(toDate(s.end)),
            departureAt: new Date(toDate(s.departure)),
            legDistanceKm: s.legKm,
            legDriveMinutes: s.legMin,
          })),
          {
            userId: user.id,
            routePlanId: plan!.id,
            seq: schedule.stops.length + 1,
            kind: "end" as const,
            label: end.label,
            lat: end.location?.lat,
            lng: end.location?.lng,
            arrivalAt: new Date(toDate(schedule.returnLeg.arrival)),
            legDistanceKm: schedule.returnLeg.km,
            legDriveMinutes: schedule.returnLeg.minutes,
          },
        ]);
        return plan!.id;
      };
      const current = await save("current", initial, null);
      const optimized = await save("optimized", best.schedule, current);
      return [current, optimized] as const;
    });
  }

  const nearby = await nearbyCandidates(user, located, all, ctx, estimate, home);

  return {
    day,
    provider: travelRes.provider,
    fallbackReason: travelRes.fallbackReason,
    warnings,
    start,
    end,
    unlocated,
    stops: byId,
    initial,
    optimized: best.schedule,
    comparison,
    method: best.method,
    evaluated: best.evaluated,
    points,
    currentPlanId,
    optimizedPlanId,
    nearby,
    allowConfirmed: Boolean(options.allowConfirmed),
    movedConfirmed: best.schedule.stops
      .filter((s) => byId[s.id]!.appointment.status === "confirmed")
      .map((s) => ({ id: s.id, label: s.label, from: minutesOfDay(byId[s.id]!.appointment.startsAt, user.timezone), to: s.start }))
      .filter((m) => Math.abs(m.from - m.to) >= 1),
  };
}

/** Pharmacies à visiter (en retard ou bientôt dues) situées près de la tournée du jour. */
async function nearbyCandidates(
  user: SessionUser,
  located: AppointmentWithPharmacy[],
  all: AppointmentWithPharmacy[],
  ctx: DayContext,
  estimate: { roadFactor: number; speedKmh: number },
  home: LatLng | null,
): Promise<NearbySuggestion[]> {
  const overview = await getPharmacyOverview(user);
  const plannedToday = new Set(all.map((a) => a.pharmacy?.id).filter(Boolean));
  const routePoints = located.map((a) => ({ lat: a.pharmacy!.lat!, lng: a.pharmacy!.lng! }));
  const dayPlan = {
    preferredDepartments: [],
    appointments: all.map((a) => ({
      id: a.appointment.id,
      label: a.appointment.title,
      start: minutesOfDay(a.appointment.startsAt, user.timezone),
      end: minutesOfDay(a.appointment.endsAt, user.timezone),
      location: a.pharmacy && hasLocation(a.pharmacy) ? { lat: a.pharmacy.lat, lng: a.pharmacy.lng } : null,
      departmentCode: a.pharmacy?.departmentCode ?? null,
      kind: a.appointment.kind,
    })),
  };
  const out: (NearbySuggestion & { priority: number })[] = [];
  for (const item of overview) {
    const p = item.pharmacy;
    if (plannedToday.has(p.id) || !hasLocation(p)) continue;
    const s = item.status;
    if (!["overdue", "due_soon", "never_visited"].includes(s.dueState)) continue;
    const loc = { lat: p.lat, lng: p.lng };
    const nearest = Math.min(...routePoints.map((r) => haversineKm(r, loc)));
    if (nearest > 15) continue;
    const slot = bestSlotInDay(
      dayPlan,
      {
        id: p.id,
        label: p.name,
        location: loc,
        departmentCode: p.departmentCode,
        category: item.metrics?.category ?? null,
        preferredWeekdays: [],
        excludedWeekdays: [],
        preferredStart: null,
        preferredEnd: null,
        visitMinutes: null,
      },
      user.defaultVisitMinutes,
      {
        workStart: ctx.workStart,
        workEnd: ctx.workEnd,
        lunchStart: ctx.lunchStart,
        lunchMinutes: ctx.lunchMinutes,
        bufferMinutes: ctx.bufferMinutes,
        defaultVisitMinutes: user.defaultVisitMinutes,
        home,
        hotelThresholdKm: 9999,
        mustReturnHomeWeekdays: [],
        estimate,
      },
    );
    const detourKm = slot?.detourKm ?? nearest * 2 * estimate.roadFactor;
    const urgency = s.dueState === "overdue" ? 1.5 + Math.min(1, -(s.daysUntilDue ?? 0) / 90) : s.dueState === "never_visited" ? 1.2 : 1;
    const dueLabel =
      s.dueState === "overdue"
        ? `En retard de ${-(s.daysUntilDue ?? 0)} j`
        : s.dueState === "never_visited"
          ? "Aucune visite connue"
          : `Échéance dans ${s.daysUntilDue} j`;
    out.push({
      pharmacyId: p.id,
      name: p.name,
      city: p.city,
      category: item.metrics?.category ?? null,
      dueLabel,
      detourKm,
      start: slot?.start ?? null,
      location: loc,
      priority: (categoryWeight(item.metrics?.category) * urgency) / (1 + detourKm / 10),
    });
  }
  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 6)
    .map(({ priority: _p, ...rest }) => rest);
}

/**
 * Applique le scénario optimisé : seules les visites non confirmées changent
 * d'horaire. Refusé si le planning a changé depuis la simulation.
 */
export async function applyRoutePlan(db: Db, user: SessionUser, planId: string, options: { allowConfirmed?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(routePlans).where(and(eq(routePlans.id, planId), eq(routePlans.userId, user.id)));
    if (!plan || plan.kind !== "optimized") throw new RoutePlanError("Scénario introuvable.");
    if (plan.status !== "draft") throw new RoutePlanError("Ce scénario a déjà été appliqué ou écarté.");
    const stops = await tx
      .select()
      .from(routeStops)
      .where(and(eq(routeStops.routePlanId, planId), eq(routeStops.kind, "visit")));
    const ids = stops.map((s) => s.appointmentId!).filter(Boolean);
    const current = ids.length
      ? await tx
          .select()
          .from(appointments)
          .where(and(eq(appointments.userId, user.id), inArray(appointments.id, ids)))
      : [];
    if (current.length !== ids.length || current.some((a) => a.updatedAt > plan.createdAt)) {
      throw new RoutePlanError("Le planning a changé depuis la simulation : relancez-la avant d'appliquer.");
    }
    let changed = 0;
    for (const stop of stops) {
      const appt = current.find((a) => a.id === stop.appointmentId)!;
      const moveConfirmed = Boolean(options.allowConfirmed && plan.metrics.allowConfirmed);
      if ((appt.status === "confirmed" && !moveConfirmed) || !stop.visitStartAt) continue;
      const duration = appt.endsAt.getTime() - appt.startsAt.getTime();
      if (appt.startsAt.getTime() === stop.visitStartAt.getTime()) continue;
      const startsAt = stop.visitStartAt;
      const endsAt = new Date(startsAt.getTime() + duration);
      await tx.update(appointments).set({ startsAt, endsAt }).where(eq(appointments.id, appt.id));
      await logAudit(tx, {
        userId: user.id,
        entity: "appointment",
        entityId: appt.id,
        action: "move",
        before: { startsAt: appt.startsAt, endsAt: appt.endsAt },
        after: { startsAt, endsAt },
        reason:
          appt.status === "confirmed"
            ? `Rendez-vous confirmé déplacé avec accord explicite — scénario du ${plan.planDate}`
            : `Scénario de tournée appliqué (${plan.planDate})`,
      });
      changed++;
    }
    await tx.update(routePlans).set({ status: "applied", appliedAt: new Date() }).where(eq(routePlans.id, planId));
    if (plan.comparedToPlanId) await tx.update(routePlans).set({ status: "discarded" }).where(eq(routePlans.id, plan.comparedToPlanId));
    await logAudit(tx, { userId: user.id, entity: "route_plan", entityId: planId, action: "apply", after: { changed } });
    return { changed };
  });
}
