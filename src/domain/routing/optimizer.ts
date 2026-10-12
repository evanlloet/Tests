/**
 * Optimisation de l'ordre de passage d'une journée, sous contraintes.
 *
 * - Les rendez-vous confirmés gardent leur heure : le moteur choisit seulement
 *   l'ordre et les horaires des visites non confirmées autour d'eux.
 * - Recherche exhaustive jusqu'à 8 visites (≤ 40 320 ordres), au-delà recherche
 *   locale (2-opt + déplacement d'une visite) à partir de plusieurs ordres initiaux.
 * - Coût : conduite, distance, attente + pénalités de contraintes (voir schedule.ts).
 */
import { formatDuration, formatHHmm } from "../time";
import { simulateDay, type DayContext, type PlanStop, type ScheduleResult } from "./schedule";
import type { TravelMatrix } from "./types";

export const EXHAUSTIVE_LIMIT = 8;

export type OptimizeInput = {
  ctx: DayContext;
  stops: PlanStop[];
  startIndex: number;
  endIndex: number;
  matrix: TravelMatrix;
};

export type OptimizeResult = {
  order: PlanStop[];
  schedule: ScheduleResult;
  method: "exhaustive" | "local_search" | "trivial";
  evaluated: number;
};

export function optimizeDay(input: OptimizeInput): OptimizeResult {
  const { stops } = input;
  const evaluate = (order: PlanStop[]) => simulateDay({ ...input, stops: order });

  if (stops.length <= 1) {
    return { order: stops, schedule: evaluate(stops), method: "trivial", evaluated: 1 };
  }

  if (stops.length <= EXHAUSTIVE_LIMIT) {
    let best = { order: stops, schedule: evaluate(stops) };
    let evaluated = 1;
    permute(stops.slice(), (perm) => {
      evaluated++;
      const schedule = evaluate(perm);
      if (schedule.cost < best.schedule.cost - 1e-9) best = { order: perm.slice(), schedule };
    });
    return { ...best, method: "exhaustive", evaluated };
  }

  // Recherche locale à partir de plusieurs ordres initiaux
  const seeds = [stops.slice(), sortByFixedTime(stops), nearestNeighbour(input)];
  let best: { order: PlanStop[]; schedule: ScheduleResult } | null = null;
  let evaluated = 0;
  for (const seed of seeds) {
    let current = { order: seed, schedule: evaluate(seed) };
    evaluated++;
    let improved = true;
    let rounds = 0;
    while (improved && rounds++ < 200) {
      improved = false;
      // 2-opt : inversion d'un segment
      for (let i = 0; i < current.order.length - 1 && !improved; i++) {
        for (let j = i + 1; j < current.order.length && !improved; j++) {
          const candidate = [
            ...current.order.slice(0, i),
            ...current.order.slice(i, j + 1).reverse(),
            ...current.order.slice(j + 1),
          ];
          const schedule = evaluate(candidate);
          evaluated++;
          if (schedule.cost < current.schedule.cost - 1e-9) {
            current = { order: candidate, schedule };
            improved = true;
          }
        }
      }
      // Déplacement d'une visite à une autre position
      for (let i = 0; i < current.order.length && !improved; i++) {
        for (let j = 0; j < current.order.length && !improved; j++) {
          if (i === j) continue;
          const candidate = current.order.slice();
          const [moved] = candidate.splice(i, 1);
          candidate.splice(j, 0, moved!);
          const schedule = evaluate(candidate);
          evaluated++;
          if (schedule.cost < current.schedule.cost - 1e-9) {
            current = { order: candidate, schedule };
            improved = true;
          }
        }
      }
    }
    if (!best || current.schedule.cost < best.schedule.cost - 1e-9) best = current;
  }
  return { ...best!, method: "local_search", evaluated };
}

/** Algorithme de Heap : visite toutes les permutations (sans la permutation initiale). */
function permute<T>(arr: T[], visit: (perm: T[]) => void) {
  const c = new Array(arr.length).fill(0);
  let i = 1;
  while (i < arr.length) {
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [arr[i], arr[k]] = [arr[k]!, arr[i]!];
      visit(arr);
      c[i]++;
      i = 1;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

function sortByFixedTime(stops: PlanStop[]): PlanStop[] {
  return stops.slice().sort((a, b) => (a.fixedStart ?? a.earliest ?? 0) - (b.fixedStart ?? b.earliest ?? 0));
}

function nearestNeighbour(input: OptimizeInput): PlanStop[] {
  const remaining = input.stops.slice();
  const out: PlanStop[] = [];
  let pos = input.startIndex;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((s, idx) => {
      const d = input.matrix.durationsMin[pos]?.[s.pointIndex] ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    const [next] = remaining.splice(bestIdx, 1);
    out.push(next!);
    pos = next!.pointIndex;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Comparaison et explication                                                  */
/* -------------------------------------------------------------------------- */

export type ScenarioComparison = {
  kmSaved: number;
  kmSavedPct: number;
  driveMinutesSaved: number;
  returnShiftMinutes: number;
  orderChanged: boolean;
  confirmedUnchanged: number;
  resolvedViolations: string[];
  remainingViolations: string[];
  newViolations: string[];
  worthApplying: boolean;
  explanation: string[];
};

/** Gain minimal pour recommander un changement d'ordre */
export const MIN_USEFUL_KM_GAIN = 3;
export const MIN_USEFUL_MINUTES_GAIN = 5;

export function compareScenarios(initial: ScheduleResult, optimized: ScheduleResult): ScenarioComparison {
  const kmSaved = initial.totalKm - optimized.totalKm;
  const driveSaved = initial.totalDriveMin - optimized.totalDriveMin;
  const returnShift = optimized.returnLeg.arrival - initial.returnLeg.arrival;
  const orderChanged = initial.stops.map((s) => s.id).join() !== optimized.stops.map((s) => s.id).join();
  const key = (v: { code: string; stopId?: string }) => `${v.code}:${v.stopId ?? ""}`;
  const initialKeys = new Set(initial.violations.map(key));
  const optimizedKeys = new Set(optimized.violations.map(key));
  const resolved = initial.violations.filter((v) => !optimizedKeys.has(key(v))).map((v) => v.message);
  const remaining = optimized.violations.filter((v) => initialKeys.has(key(v))).map((v) => v.message);
  const added = optimized.violations.filter((v) => !initialKeys.has(key(v))).map((v) => v.message);
  const confirmedUnchanged = optimized.stops.filter((s) => s.fixed).length;

  const worthApplying =
    orderChanged &&
    optimized.cost < initial.cost &&
    (kmSaved >= MIN_USEFUL_KM_GAIN || driveSaved >= MIN_USEFUL_MINUTES_GAIN || resolved.length > added.length);

  const explanation: string[] = [];
  if (!orderChanged) {
    explanation.push("L'ordre actuel est déjà le meilleur trouvé avec ces contraintes : rien à changer.");
  } else if (!worthApplying) {
    explanation.push(
      `Un autre ordre existe mais le gain est négligeable (${fmtKm(kmSaved)}, ${formatDuration(Math.max(0, driveSaved))}) : conserver le planning actuel est raisonnable.`,
    );
  } else {
    explanation.push(
      `Distance : ${fmtKm(initial.totalKm)} → ${fmtKm(optimized.totalKm)} (${kmSaved >= 0 ? "−" : "+"}${fmtKm(Math.abs(kmSaved))}, ${pct(kmSaved, initial.totalKm)}).`,
    );
    explanation.push(
      `Conduite : ${formatDuration(initial.totalDriveMin)} → ${formatDuration(optimized.totalDriveMin)}${driveSaved > 0 ? ` (−${formatDuration(driveSaved)})` : ""}.`,
    );
    explanation.push(
      `Retour : ${formatHHmm(initial.returnLeg.arrival)} → ${formatHHmm(optimized.returnLeg.arrival)}${returnShift < 0 ? ` (${formatDuration(-returnShift)} plus tôt)` : returnShift > 0 ? ` (${formatDuration(returnShift)} plus tard)` : ""}.`,
    );
    const moves = describeMoves(initial, optimized);
    if (moves.length) explanation.push(...moves);
  }
  if (confirmedUnchanged > 0) {
    explanation.push(`${confirmedUnchanged} rendez-vous confirmé${confirmedUnchanged > 1 ? "s" : ""} conservé${confirmedUnchanged > 1 ? "s" : ""} à l'heure prévue.`);
  }
  for (const r of resolved) explanation.push(`Résolu : ${r}`);
  for (const r of added) explanation.push(`Nouvelle contrainte : ${r}`);
  for (const r of remaining) explanation.push(`Non résolu : ${r}`);

  return {
    kmSaved,
    kmSavedPct: initial.totalKm > 0 ? (kmSaved / initial.totalKm) * 100 : 0,
    driveMinutesSaved: driveSaved,
    returnShiftMinutes: returnShift,
    orderChanged,
    confirmedUnchanged,
    resolvedViolations: resolved,
    remainingViolations: remaining,
    newViolations: added,
    worthApplying,
    explanation,
  };
}

function describeMoves(initial: ScheduleResult, optimized: ScheduleResult): string[] {
  const out: string[] = [];
  optimized.stops.forEach((s, newIdx) => {
    const oldIdx = initial.stops.findIndex((o) => o.id === s.id);
    if (oldIdx !== newIdx && !s.fixed) {
      out.push(`« ${s.label} » passe de la ${ordinal(oldIdx + 1)} à la ${ordinal(newIdx + 1)} position (${formatHHmm(s.start)}).`);
    }
  });
  return out.slice(0, 6);
}

const ordinal = (n: number) => (n === 1 ? "1re" : `${n}e`);
const fmtKm = (km: number) => `${Math.round(km).toLocaleString("fr-FR")} km`;
const pct = (part: number, total: number) => (total > 0 ? `${part >= 0 ? "−" : "+"}${Math.abs(Math.round((part / total) * 100))} %` : "—");
