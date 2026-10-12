/**
 * Propositions de créneaux pour la prochaine visite d'une pharmacie.
 *
 * Les propositions ne sont pas de simples dates libres : chaque jour candidat est
 * évalué à partir du planning complet (rendez-vous existants, secteur prévu ce
 * jour-là, détour par rapport aux visites voisines, préférences du pharmacien,
 * charge de la journée, retour au domicile). Chaque proposition liste ses
 * avantages et ses inconvénients.
 */
import type { Category } from "../frequency";
import { haversineKm, type LatLng } from "../geo";
import { publicHolidayName } from "../holidays";
import { estimateLeg, type EstimateParams } from "../routing/estimate";
import { addDays, diffDays, formatHHmm, isoWeekday, WEEKDAY_LABELS, type DayKey } from "../time";

export type DayAppointment = {
  id: string;
  label: string;
  start: number;
  end: number;
  location: LatLng | null;
  departmentCode: string | null;
  kind: "visit" | "unavailable" | "other";
};

export type DayPlan = {
  appointments: DayAppointment[];
  /** Départements privilégiés ce jour-là (modèle de semaine actif) */
  preferredDepartments: string[];
};

export type SuggestSettings = {
  workStart: number;
  workEnd: number;
  lunchStart: number;
  lunchMinutes: number;
  bufferMinutes: number;
  defaultVisitMinutes: number;
  home: LatLng | null;
  hotelThresholdKm: number;
  mustReturnHomeWeekdays: number[];
  estimate: EstimateParams;
};

export type SuggestTarget = {
  id: string;
  label: string;
  location: LatLng | null;
  departmentCode: string | null;
  category: Category | null;
  preferredWeekdays: number[];
  excludedWeekdays: number[];
  preferredStart: number | null;
  preferredEnd: number | null;
  visitMinutes: number | null;
};

export type SlotSuggestion = {
  day: DayKey;
  start: number;
  end: number;
  score: number;
  detourKm: number | null;
  pros: string[];
  cons: string[];
  /** Écart en jours avec l'échéance cible (négatif = avant) */
  offsetFromTarget: number;
};

const SLOT_STEP = 15;

export function suggestSlots(input: {
  target: SuggestTarget;
  targetDay: DayKey;
  today: DayKey;
  days: Map<DayKey, DayPlan>;
  settings: SuggestSettings;
  /** Jours explorés avant / après l'échéance */
  daysBefore?: number;
  daysAfter?: number;
  maxResults?: number;
  departmentNames?: Record<string, string>;
}): SlotSuggestion[] {
  const { target, settings, today } = input;
  const daysBefore = input.daysBefore ?? 21;
  const daysAfter = input.daysAfter ?? 35;
  const tomorrow = addDays(today, 1);
  const effectiveTarget = input.targetDay < tomorrow ? tomorrow : input.targetDay;
  let from = addDays(effectiveTarget, -daysBefore);
  if (from < tomorrow) from = tomorrow;
  const to = addDays(effectiveTarget, daysAfter);
  const duration = target.visitMinutes ?? settings.defaultVisitMinutes;
  const deptName = (code: string | null) => (code ? (input.departmentNames?.[code] ?? code) : "inconnu");

  const out: SlotSuggestion[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = isoWeekday(day);
    if (weekday > 5) continue;
    if (target.excludedWeekdays.includes(weekday)) continue;
    if (publicHolidayName(day)) continue;

    const plan = input.days.get(day) ?? { appointments: [], preferredDepartments: [] };
    if (plan.appointments.some((a) => a.kind === "unavailable" && a.start <= settings.workStart && a.end >= settings.workEnd)) {
      continue;
    }
    const slot = bestSlotInDay(plan, target, duration, settings);
    if (!slot) continue;

    const pros: string[] = [];
    const cons: string[] = [];
    let score = 100;

    const offset = diffDays(effectiveTarget, day);
    if (offset < 0) {
      score -= 0.6 * -offset;
      if (offset <= -7) cons.push(`${-offset} jours avant l'échéance cible`);
    } else if (offset > 0) {
      score -= 1.2 * offset;
      if (offset >= 7) cons.push(`${offset} jours après l'échéance cible`);
    }
    if (Math.abs(offset) <= 3) pros.push("Proche de l'échéance cible");

    const visits = plan.appointments.filter((a) => a.kind === "visit");
    const sameDept = target.departmentCode ? visits.filter((a) => a.departmentCode === target.departmentCode).length : 0;
    if (target.departmentCode && plan.preferredDepartments.includes(target.departmentCode)) {
      score += 25;
      pros.push(`${WEEKDAY_LABELS[weekday]} est consacré au secteur ${deptName(target.departmentCode)}`);
    } else if (sameDept > 0) {
      score += 10;
    } else if (plan.preferredDepartments.length > 0) {
      score -= 15;
      cons.push(`${WEEKDAY_LABELS[weekday]} est prévu pour ${plan.preferredDepartments.map(deptName).join(", ")}`);
    }
    if (sameDept > 0) {
      score += Math.min(24, sameDept * 6);
      pros.push(`${sameDept} rendez-vous déjà prévu${sameDept > 1 ? "s" : ""} dans le même secteur`);
    }

    if (slot.detourKm !== null) {
      score -= Math.min(40, 0.5 * slot.detourKm);
      if (visits.length > 0 && slot.detourKm <= 15) pros.push(`Détour limité (+${Math.round(slot.detourKm)} km)`);
      if (slot.detourKm > 40) cons.push(`Détour important (+${Math.round(slot.detourKm)} km)`);
    } else {
      cons.push("Trajet non évalué : coordonnées manquantes");
    }
    if (visits.length === 0) {
      cons.push("Aucun autre rendez-vous ce jour-là : déplacement dédié");
      score -= 8;
    }
    if (target.preferredWeekdays.includes(weekday)) {
      score += 12;
      pros.push("Jour préféré du pharmacien");
    }
    if (visits.length >= 6) {
      score -= 10;
      cons.push(`Journée déjà chargée (${visits.length} visites)`);
    }
    if (slot.unknownNeighbour) cons.push("Lieu d'un rendez-vous voisin inconnu : trajet partiellement évalué");
    if (
      settings.home &&
      target.location &&
      settings.mustReturnHomeWeekdays.includes(weekday) &&
      haversineKm(settings.home, target.location) * settings.estimate.roadFactor > settings.hotelThresholdKm
    ) {
      score -= 10;
      cons.push("Retour au domicile obligatoire ce jour-là alors que la pharmacie est éloignée");
    }

    out.push({
      day,
      start: slot.start,
      end: slot.start + duration,
      score: Math.round(score * 10) / 10,
      detourKm: slot.detourKm,
      pros,
      cons,
      offsetFromTarget: offset,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.day.localeCompare(b.day)).slice(0, input.maxResults ?? 5);
}

type Anchor = { end: number; start: number; location: LatLng | null; isHome: boolean; isVisit: boolean };

/** Meilleur créneau d'une journée : celui qui minimise le détour, en respectant horaires, trajets et pause. */
export function bestSlotInDay(
  plan: DayPlan,
  target: SuggestTarget,
  duration: number,
  settings: SuggestSettings,
): { start: number; detourKm: number | null; unknownNeighbour: boolean } | null {
  const appts = plan.appointments.slice().sort((a, b) => a.start - b.start);
  const anchors: Anchor[] = [
    { start: settings.workStart, end: settings.workStart, location: settings.home, isHome: true, isVisit: false },
    ...appts.map((a) => ({ start: a.start, end: a.end, location: a.location, isHome: false, isVisit: a.kind === "visit" })),
    { start: settings.workEnd, end: settings.workEnd, location: settings.home, isHome: true, isVisit: false },
  ];
  const lunchEnd = settings.lunchStart + settings.lunchMinutes;
  let best: { start: number; detourKm: number | null; unknownNeighbour: boolean } | null = null;

  for (let i = 0; i < anchors.length - 1; i++) {
    const prev = anchors[i]!;
    const next = anchors[i + 1]!;
    const legIn = prev.location && target.location ? estimateLeg(prev.location, target.location, settings.estimate) : null;
    const legOut = target.location && next.location ? estimateLeg(target.location, next.location, settings.estimate) : null;
    const direct = prev.location && next.location ? estimateLeg(prev.location, next.location, settings.estimate) : null;

    let start = prev.end + (prev.isHome ? 0 : settings.bufferMinutes) + (legIn?.minutes ?? 0);
    if (target.preferredStart !== null) start = Math.max(start, target.preferredStart);
    start = Math.ceil(start / SLOT_STEP) * SLOT_STEP;
    // Pause déjeuner protégée
    if (start < lunchEnd && start + duration > settings.lunchStart) start = Math.ceil(lunchEnd / SLOT_STEP) * SLOT_STEP;
    const latestEnd = next.start - (legOut?.minutes ?? 0) - (next.isHome ? 0 : settings.bufferMinutes);
    if (start + duration > latestEnd) continue;
    if (target.preferredEnd !== null && start > target.preferredEnd) continue;
    if (start < settings.workStart || start + duration > settings.workEnd) continue;

    const detourKm = legIn && legOut ? legIn.km + legOut.km - (direct?.km ?? 0) : null;
    const unknownNeighbour = (prev.isVisit && !prev.location) || (next.isVisit && !next.location);
    if (!best || (detourKm ?? Infinity) < (best.detourKm ?? Infinity)) {
      best = { start, detourKm, unknownNeighbour };
    }
  }
  return best;
}

export function describeSlot(s: SlotSuggestion): string {
  return `${formatHHmm(s.start)}–${formatHHmm(s.end)}`;
}
