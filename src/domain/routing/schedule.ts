/**
 * Simulation d'une journée de tournée : à partir d'un ordre de passage, calcule les
 * heures d'arrivée, d'attente, de visite et de retour, puis liste les contraintes
 * non respectées. Fonction pure et déterministe : la même entrée donne toujours le
 * même résultat (testé dans schedule.test.ts).
 *
 * Toutes les heures sont exprimées en minutes depuis minuit (heure locale).
 */
import { formatHHmm } from "../time";
import type { TravelMatrix } from "./types";

export type DayContext = {
  /** Départ au plus tôt du point de départ (domicile / hôtel) */
  workStart: number;
  /** Retour souhaité au plus tard */
  workEnd: number;
  lunchStart: number;
  lunchMinutes: number;
  /** Le déjeuner peut commencer jusqu'à `lunchFlexMinutes` après `lunchStart` */
  lunchFlexMinutes: number;
  bufferMinutes: number;
  maxDriveMinutes: number;
};

export type PlanStop = {
  id: string;
  label: string;
  /** Indice du point dans la matrice de trajets */
  pointIndex: number;
  durationMin: number;
  /** Heure imposée (rendez-vous confirmé) — jamais déplacée par le moteur */
  fixedStart: number | null;
  /** Fenêtre de début préférée par le pharmacien */
  earliest: number | null;
  latest: number | null;
};

export type ViolationCode =
  | "late_confirmed"
  | "outside_preferred_window"
  | "day_too_long"
  | "lunch_not_protected"
  | "lunch_late"
  | "drive_limit"
  | "departure_too_early";

export type Violation = {
  code: ViolationCode;
  severity: "hard" | "soft";
  message: string;
  stopId?: string;
  minutes: number;
};

export type ScheduledStop = {
  id: string;
  label: string;
  pointIndex: number;
  arrival: number;
  start: number;
  end: number;
  departure: number;
  waitMin: number;
  legKm: number;
  legMin: number;
  lunchBefore: { start: number; end: number } | null;
  fixed: boolean;
};

export type ScheduleResult = {
  departure: number;
  stops: ScheduledStop[];
  returnLeg: { km: number; minutes: number; arrival: number };
  lunch: { start: number; end: number } | null;
  totalKm: number;
  totalDriveMin: number;
  totalWaitMin: number;
  totalVisitMin: number;
  violations: Violation[];
  /** Coût utilisé par l'optimiseur (plus bas = meilleur) */
  cost: number;
};

/** Les horaires calculés pour les visites non figées sont arrondis aux 5 minutes supérieures. */
export const TIME_STEP = 5;
const roundUp = (m: number) => Math.ceil(m / TIME_STEP - 1e-9) * TIME_STEP;

export function simulateDay(input: {
  ctx: DayContext;
  stops: PlanStop[];
  startIndex: number;
  endIndex: number;
  matrix: TravelMatrix;
}): ScheduleResult {
  const { ctx, stops, startIndex, endIndex, matrix } = input;
  const leg = (from: number, to: number) => ({
    km: matrix.distancesKm[from]?.[to] ?? 0,
    min: matrix.durationsMin[from]?.[to] ?? 0,
  });
  const violations: Violation[] = [];
  const latestLunchStart = ctx.lunchStart + ctx.lunchFlexMinutes;

  // Départ : à l'heure de début, ou juste à temps pour un premier rendez-vous imposé.
  // Un rendez-vous confirmé tôt et loin impose un départ anticipé (signalé), jamais un retard.
  let departure = ctx.workStart;
  const first = stops[0];
  if (first) {
    const firstLeg = leg(startIndex, first.pointIndex);
    if (first.fixedStart !== null) departure = first.fixedStart - firstLeg.min;
    else if (first.earliest !== null && first.earliest - firstLeg.min > departure) departure = first.earliest - firstLeg.min;
  }

  let t = departure;
  let position = startIndex;
  let lunch: { start: number; end: number } | null = null;
  const scheduled: ScheduledStop[] = [];
  let totalKm = 0;
  let totalDrive = 0;
  let totalWait = 0;
  let totalVisit = 0;

  for (const stop of stops) {
    const l = leg(position, stop.pointIndex);
    totalKm += l.km;
    totalDrive += l.min;
    const arrival = t + l.min;
    let lunchBefore: ScheduledStop["lunchBefore"] = null;

    const desired = (from: number) => {
      if (stop.fixedStart !== null) return stop.fixedStart;
      return roundUp(Math.max(from, stop.earliest ?? from));
    };
    let start = desired(arrival);

    if (!lunch) {
      const endIfVisitFirst = Math.max(arrival, start) + stop.durationMin;
      if (endIfVisitFirst > latestLunchStart) {
        const lunchBegin = Math.max(arrival, ctx.lunchStart);
        const lunchEnd = lunchBegin + ctx.lunchMinutes;
        if (stop.fixedStart === null || lunchEnd <= stop.fixedStart) {
          lunch = { start: lunchBegin, end: lunchEnd };
          lunchBefore = lunch;
          start = desired(lunchEnd);
          if (lunchBegin > latestLunchStart) {
            violations.push({
              code: "lunch_late",
              severity: "soft",
              message: `Pause déjeuner à ${formatHHmm(lunchBegin)}, plus tard que prévu`,
              minutes: lunchBegin - latestLunchStart,
            });
          }
        }
      }
    }

    if (stop.fixedStart !== null && start < arrival) start = arrival;
    if (stop.fixedStart !== null && arrival > stop.fixedStart) {
      const late = Math.round(arrival - stop.fixedStart);
      violations.push({
        code: "late_confirmed",
        severity: "hard",
        message: `Arrivée ${late} min après l'heure du rendez-vous confirmé « ${stop.label} » (${formatHHmm(stop.fixedStart)})`,
        stopId: stop.id,
        minutes: late,
      });
    }
    if (stop.latest !== null && start > stop.latest) {
      violations.push({
        code: "outside_preferred_window",
        severity: "soft",
        message: `« ${stop.label} » commence à ${formatHHmm(start)}, après l'horaire souhaité par le pharmacien (${formatHHmm(stop.latest)})`,
        stopId: stop.id,
        minutes: start - stop.latest,
      });
    }

    const wait = Math.max(0, start - arrival - (lunchBefore ? ctx.lunchMinutes : 0));
    totalWait += wait;
    const end = start + stop.durationMin;
    totalVisit += stop.durationMin;
    let departureFromStop = end + ctx.bufferMinutes;

    // Déjeuner repoussé : pris juste après la visite, sauf s'il mettrait en retard
    // le rendez-vous imposé suivant (la pause est alors signalée comme non protégée)
    const nextStop = stops[stops.indexOf(stop) + 1];
    const lunchWouldMakeLate =
      nextStop?.fixedStart !== null &&
      nextStop !== undefined &&
      end + ctx.bufferMinutes + ctx.lunchMinutes + leg(stop.pointIndex, nextStop.pointIndex).min > nextStop.fixedStart!;
    if (!lunch && end > latestLunchStart && nextStop && !lunchWouldMakeLate) {
      lunch = { start: end, end: end + ctx.lunchMinutes };
      departureFromStop = Math.max(departureFromStop, lunch.end);
      violations.push({
        code: "lunch_late",
        severity: "soft",
        message: `Pause déjeuner repoussée à ${formatHHmm(end)} à cause de « ${stop.label} »`,
        minutes: end - latestLunchStart,
      });
    }

    scheduled.push({
      id: stop.id,
      label: stop.label,
      pointIndex: stop.pointIndex,
      arrival,
      start,
      end,
      departure: departureFromStop,
      waitMin: wait,
      legKm: l.km,
      legMin: l.min,
      lunchBefore,
      fixed: stop.fixedStart !== null,
    });
    t = departureFromStop;
    position = stop.pointIndex;
  }

  const back = leg(position, endIndex);
  totalKm += back.km;
  totalDrive += back.min;
  const lastEnd = scheduled.at(-1)?.end ?? departure;
  const returnArrival = (scheduled.length ? t - ctx.bufferMinutes : t) + back.min;

  if (!lunch && lastEnd > latestLunchStart + ctx.lunchMinutes) {
    violations.push({
      code: "lunch_not_protected",
      severity: "soft",
      message: "Aucune pause déjeuner possible avec cet enchaînement",
      minutes: ctx.lunchMinutes,
    });
  }
  if (returnArrival > ctx.workEnd) {
    violations.push({
      code: "day_too_long",
      severity: "soft",
      message: `Retour prévu à ${formatHHmm(returnArrival)}, après la fin de journée souhaitée (${formatHHmm(ctx.workEnd)})`,
      minutes: returnArrival - ctx.workEnd,
    });
  }
  if (departure < ctx.workStart) {
    violations.push({
      code: "departure_too_early",
      severity: "soft",
      message: `Départ nécessaire à ${formatHHmm(departure)}, avant le début de journée (${formatHHmm(ctx.workStart)})`,
      minutes: ctx.workStart - departure,
    });
  }
  if (totalDrive > ctx.maxDriveMinutes) {
    violations.push({
      code: "drive_limit",
      severity: "soft",
      message: `Temps de conduite (${Math.round(totalDrive)} min) supérieur à la limite fixée (${ctx.maxDriveMinutes} min)`,
      minutes: totalDrive - ctx.maxDriveMinutes,
    });
  }

  return {
    departure,
    stops: scheduled,
    returnLeg: { km: back.km, minutes: back.min, arrival: returnArrival },
    lunch,
    totalKm,
    totalDriveMin: totalDrive,
    totalWaitMin: totalWait,
    totalVisitMin: totalVisit,
    violations,
    cost: scheduleCost(totalDrive, totalKm, totalWait, violations),
  };
}

const VIOLATION_WEIGHTS: Record<ViolationCode, { fixed: number; perMinute: number }> = {
  late_confirmed: { fixed: 10_000, perMinute: 1_000 },
  outside_preferred_window: { fixed: 200, perMinute: 20 },
  day_too_long: { fixed: 100, perMinute: 20 },
  lunch_not_protected: { fixed: 500, perMinute: 0 },
  lunch_late: { fixed: 50, perMinute: 10 },
  drive_limit: { fixed: 100, perMinute: 10 },
  departure_too_early: { fixed: 50, perMinute: 10 },
};

function scheduleCost(driveMin: number, km: number, waitMin: number, violations: Violation[]): number {
  let cost = driveMin + km * 0.05 + waitMin * 0.2;
  for (const v of violations) {
    const w = VIOLATION_WEIGHTS[v.code];
    cost += w.fixed + w.perMinute * v.minutes;
  }
  return cost;
}
