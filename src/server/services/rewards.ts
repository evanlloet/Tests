import "server-only";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { intervalDays, targetVisitsPerYear } from "@/domain/frequency";
import { computeRewards, type RewardFacts, type Rewards } from "@/domain/gamification";
import { addDays, dayKeyOf, diffDays } from "@/domain/time";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { appointmentMatches, appointments, calendarImports, pharmacies, pharmacyMetrics, routePlans, visitReports } from "../db/schema";
import { frequencySettings, todayFor } from "./context";
import { getPlanning } from "./planning";

/** Fenêtre d'analyse des journées pour la série et les défis */
const WORKDAY_WINDOW = 120;

/** Rassemble les faits nécessaires aux récompenses (lecture seule). */
export async function getRewards(db: Db, user: SessionUser): Promise<Rewards> {
  const now = new Date();
  const today = todayFor(user, now);
  const freq = frequencySettings(user);

  const visits = await db
    .select({
      startsAt: appointments.startsAt,
      outcome: appointments.outcome,
      status: appointments.status,
      pharmacyId: appointments.pharmacyId,
      departmentCode: pharmacies.departmentCode,
      category: pharmacyMetrics.category,
      targetVisitsPerYear: pharmacyMetrics.targetVisitsPerYear,
    })
    .from(appointments)
    .innerJoin(pharmacies, eq(pharmacies.id, appointments.pharmacyId))
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, appointments.pharmacyId))
    .where(and(eq(appointments.userId, user.id), eq(appointments.kind, "visit"), ne(appointments.status, "cancelled"), lt(appointments.startsAt, now)))
    .orderBy(appointments.startsAt);

  // Une visite « retrouve » une pharmacie si l'écart avec la visite précédente dépassait l'intervalle cible
  const lastByPharmacy = new Map<string, string>();
  const doneVisits: RewardFacts["doneVisits"] = [];
  const departments = new Set<string>();
  for (const v of visits) {
    const counts = v.outcome === "done" || v.status === "confirmed" || v.status === "pending";
    if (!counts || v.outcome === "missed") continue;
    const day = dayKeyOf(v.startsAt, user.timezone);
    if (v.departmentCode) departments.add(v.departmentCode);
    const previous = lastByPharmacy.get(v.pharmacyId!);
    if (v.outcome === "done") {
      const target = targetVisitsPerYear(v.category, v.targetVisitsPerYear, freq).perYear;
      const rescued = Boolean(previous && target && diffDays(previous, day) > intervalDays(target));
      doneVisits.push({ day, pharmacyId: v.pharmacyId!, category: v.category, departmentCode: v.departmentCode, rescued });
    }
    lastByPharmacy.set(v.pharmacyId!, day);
  }

  const reports = (await db.select({ createdAt: visitReports.createdAt }).from(visitReports).where(eq(visitReports.userId, user.id))).map((r) => ({
    day: dayKeyOf(r.createdAt, user.timezone),
  }));
  // Valider ou ignorer rapporte autant : on récompense la vérification, pas le fait de dire « oui ».
  const [validated] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointmentMatches)
    .where(and(eq(appointmentMatches.userId, user.id), inArray(appointmentMatches.status, ["validated", "ignored"])));
  const [imports] = await db.select({ n: sql<number>`count(*)::int` }).from(calendarImports).where(eq(calendarImports.userId, user.id));
  const applied = await db
    .select({ optimized: routePlans.totalDistanceKm, comparedTo: routePlans.comparedToPlanId })
    .from(routePlans)
    .where(and(eq(routePlans.userId, user.id), eq(routePlans.kind, "optimized"), eq(routePlans.status, "applied")));
  let kmSaved = 0;
  for (const plan of applied) {
    if (!plan.comparedTo) continue;
    const [current] = await db.select({ km: routePlans.totalDistanceKm }).from(routePlans).where(eq(routePlans.id, plan.comparedTo));
    if (current) kmSaved += Math.max(0, current.km - plan.optimized);
  }
  const [ph] = await db
    .select({
      total: sql<number>`count(*)::int`,
      geolocated: sql<number>`count(*) filter (where ${pharmacies.lat} is not null)::int`,
      categorized: sql<number>`count(${pharmacyMetrics.category})::int`,
    })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(eq(pharmacies.userId, user.id));

  const planning = await getPlanning(db, user, addDays(today, -WORKDAY_WINDOW), today);
  const workdays = planning
    .filter((d) => d.visits > 0)
    .map((d) => {
      const visitsOfDay = d.appointments.filter((a) => a.kind === "visit");
      return {
        day: d.day,
        visits: visitsOfDay.length,
        closedVisits: visitsOfDay.filter((a) => a.outcome !== "unknown").length,
        balanced: d.mood.key === "light" || d.mood.key === "balanced",
      };
    });

  return computeRewards({
    today,
    doneVisits,
    reports,
    manualValidations: validated?.n ?? 0,
    calendarImports: imports?.n ?? 0,
    kmSaved,
    plansApplied: applied.length,
    pharmacies: { total: ph?.total ?? 0, geolocated: ph?.geolocated ?? 0, categorized: ph?.categorized ?? 0 },
    visitedDepartments: [...departments],
    workdays,
  });
}
