/**
 * Fréquences de visite et échéances.
 *
 * Vocabulaire :
 * - visite « réalisée » : rendez-vous passé marqué comme effectué ;
 * - visite « identifiée » : rendez-vous passé connu (ex. import Outlook) mais non confirmé comme réalisé ;
 * - visite « planifiée » : rendez-vous futur non annulé.
 */
import { addDays, diffDays, type DayKey } from "./time";

export const CATEGORIES = ["A", "B", "C", "D"] as const;
export type Category = (typeof CATEGORIES)[number];
export type FrequencySettings = Record<Category, number>;

export const DEFAULT_FREQUENCIES: FrequencySettings = { A: 4, B: 4, C: 4, D: 3 };

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export type TargetFrequency = {
  /** Visites par an, null si aucune règle ne s'applique (catégorie inconnue). */
  perYear: number | null;
  origin: "individual" | "category" | "unknown";
};

export function targetVisitsPerYear(
  category: Category | null | undefined,
  individualOverride: number | null | undefined,
  settings: FrequencySettings,
): TargetFrequency {
  if (individualOverride && individualOverride > 0) return { perYear: individualOverride, origin: "individual" };
  if (category) return { perYear: settings[category], origin: "category" };
  return { perYear: null, origin: "unknown" };
}

/** Intervalle cible entre deux visites, en jours. */
export function intervalDays(perYear: number): number {
  return Math.round(365 / perYear);
}

export type VisitState = "done" | "identified" | "planned";
export type VisitRecord = { day: DayKey; state: VisitState };

export type DueState = "unknown" | "never_visited" | "overdue" | "due_soon" | "ok" | "planned";

export type VisitStatus = {
  perYear: number | null;
  intervalDays: number | null;
  lastVisit: VisitRecord | null;
  nextPlanned: DayKey | null;
  /** Prochaine échéance cible (dernière visite + intervalle) */
  nextDue: DayKey | null;
  /** Jours restants avant l'échéance (négatif = retard) */
  daysUntilDue: number | null;
  dueState: DueState;
  /** Le prochain rendez-vous planifié dépasse l'échéance de plus de la tolérance */
  plannedLate: boolean;
  year: {
    done: number;
    identified: number;
    planned: number;
    target: number | null;
    /** Visites restant à planifier pour atteindre l'objectif annuel */
    remaining: number | null;
  };
};

export const DUE_SOON_DAYS = 21;
export const PLANNED_TOLERANCE_DAYS = 14;

export function computeVisitStatus(input: { perYear: number | null; visits: VisitRecord[]; today: DayKey }): VisitStatus {
  const { perYear, today } = input;
  const interval = perYear ? intervalDays(perYear) : null;

  const past = input.visits
    .filter((v) => v.state !== "planned" && v.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day));
  const future = input.visits
    .filter((v) => v.state === "planned" && v.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day));

  const lastVisit = past.at(-1) ?? null;
  const nextPlanned = future[0]?.day ?? null;
  const year = today.slice(0, 4);
  const inYear = (v: VisitRecord) => v.day.startsWith(year);
  const done = past.filter((v) => v.state === "done" && inYear(v)).length;
  const identified = past.filter((v) => v.state === "identified" && inYear(v)).length;
  const planned = future.filter(inYear).length;

  let nextDue: DayKey | null = null;
  let dueState: DueState = "unknown";
  if (interval !== null) {
    nextDue = lastVisit ? addDays(lastVisit.day, interval) : today;
    dueState = lastVisit ? "ok" : "never_visited";
  }
  const daysUntilDue = nextDue ? diffDays(today, nextDue) : null;
  if (lastVisit && daysUntilDue !== null) {
    if (daysUntilDue < 0) dueState = "overdue";
    else if (daysUntilDue <= DUE_SOON_DAYS) dueState = "due_soon";
  }
  const plannedLate = Boolean(nextPlanned && nextDue && diffDays(nextDue, nextPlanned) > PLANNED_TOLERANCE_DAYS);
  if (nextPlanned && dueState !== "unknown") dueState = "planned";

  return {
    perYear,
    intervalDays: interval,
    lastVisit,
    nextPlanned,
    nextDue,
    daysUntilDue,
    dueState,
    plannedLate,
    year: {
      done,
      identified,
      planned,
      target: perYear,
      remaining: perYear === null ? null : Math.max(0, perYear - done - identified - planned),
    },
  };
}

/** Priorité commerciale d'une catégorie (utilisée pour départager les propositions). */
export function categoryWeight(category: Category | null | undefined): number {
  switch (category) {
    case "A":
      return 1;
    case "B":
      return 0.8;
    case "C":
      return 0.6;
    case "D":
      return 0.4;
    default:
      return 0.5;
  }
}
