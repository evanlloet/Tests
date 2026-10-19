/**
 * Ce que l'assistant apprend :
 *  1. de l'agenda passé (habitudes) : secteurs de chaque jour de la semaine, nombre de
 *     visites par journée, horaires, durée des visites, soirs passés à l'hôtel et
 *     hôtels habituels ;
 *  2. des réponses à ses propositions (retours) : journées acceptées ou refusées,
 *     clientes retirées d'une journée et pourquoi, clientes reportées.
 * Les retours récents comptent plus que les anciens (demi-vie de 90 jours).
 */
import type { StatsDay } from "../analytics/agenda-stats";
import type { HotelNight } from "../calendar/hotels";
import type { LatLng } from "../geo";
import { diffDays, isoWeekday, type DayKey } from "../time";

export type Habits = {
  /** Jour ISO → département → poids (somme 1) */
  sectorShare: Record<number, Record<string, number>>;
  visitsPerDay: Record<number, number>;
  startMinutes: Record<number, number>;
  endMinutes: Record<number, number>;
  visitMinutes: number;
  /** Part des soirs passés à l'hôtel, par jour ISO */
  hotelShare: Record<number, number>;
  /** Département → hôtel le plus utilisé */
  hotels: Record<string, { name: string; city: string | null; location: LatLng | null; nights: number }>;
  fieldDaysPerWeek: number;
  /** Nombre de journées terrain analysées (fiabilité) */
  daysAnalysed: number;
};

const median = (xs: number[], fallback: number) => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Habitudes tirées des journées passées (12 derniers mois conseillés). La semaine type sert d'a priori. */
export function learnHabits(days: StatsDay[], nights: HotelNight[], template: Record<number, string[]>, visitDurations: number[]): Habits {
  const field = days.filter((d) => d.onsite > 0 && d.weekday <= 5);
  const sectorShare: Habits["sectorShare"] = {};
  const visitsPerDay: Habits["visitsPerDay"] = {};
  const startMinutes: Habits["startMinutes"] = {};
  const endMinutes: Habits["endMinutes"] = {};
  const hotelShare: Habits["hotelShare"] = {};
  for (let wd = 1; wd <= 5; wd++) {
    const ds = field.filter((d) => d.weekday === wd);
    const w: Record<string, number> = {};
    // A priori : la semaine type compte pour 3 journées
    for (const code of template[wd] ?? []) w[code] = (w[code] ?? 0) + 3 / Math.max(1, (template[wd] ?? []).length);
    for (const d of ds) d.sectors.forEach((code, i) => (w[code] = (w[code] ?? 0) + (i === 0 ? 1 : 0.5)));
    const total = Object.values(w).reduce((s, x) => s + x, 0);
    sectorShare[wd] = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, total ? v / total : 0]));
    visitsPerDay[wd] = Math.max(2, Math.round(median(ds.map((d) => d.onsite), 5)));
    startMinutes[wd] = Math.round(median(ds.filter((d) => d.firstStart !== null).map((d) => d.firstStart!), 9 * 60 + 30) / 15) * 15;
    endMinutes[wd] = Math.round(median(ds.filter((d) => d.lastEnd !== null).map((d) => d.lastEnd!), 17 * 60 + 30) / 15) * 15;
    const weekdaysWorked = ds.length;
    hotelShare[wd] = weekdaysWorked ? nights.filter((n) => isoWeekday(n.night) === wd).length / weekdaysWorked : 0;
  }
  const hotels: Habits["hotels"] = {};
  const counts = new Map<string, { name: string; city: string | null; location: LatLng | null; nights: number; dep: string }>();
  for (const n of nights) {
    if (!n.departmentCode) continue;
    const key = `${n.departmentCode}|${n.hotel.toLowerCase()}`;
    const c = counts.get(key) ?? { name: n.hotel, city: n.city, location: n.location, nights: 0, dep: n.departmentCode };
    c.nights++;
    counts.set(key, c);
  }
  for (const c of counts.values()) if (!hotels[c.dep] || hotels[c.dep]!.nights < c.nights) hotels[c.dep] = { name: c.name, city: c.city, location: c.location, nights: c.nights };
  const weeks = new Set(field.map((d) => weekKey(d.day)));
  return {
    sectorShare,
    visitsPerDay,
    startMinutes,
    endMinutes,
    visitMinutes: Math.max(30, Math.round(median(visitDurations, 60) / 15) * 15),
    hotelShare,
    hotels,
    fieldDaysPerWeek: weeks.size ? Math.round((field.length / weeks.size) * 10) / 10 : 5,
    daysAnalysed: field.length,
  };
}

function weekKey(day: DayKey) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (isoWeekday(day) - 1));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

export type FeedbackKind = "day" | "client_day" | "client_snooze";
export type FeedbackReason =
  | "accepted"
  | "other_sector"
  | "not_field_day"
  | "client_unavailable_weekday"
  | "too_soon"
  | "day_too_full"
  | "other";

export type AssistantFeedback = {
  kind: FeedbackKind;
  action: "accepted" | "rejected";
  day: DayKey | null;
  weekday: number | null;
  departmentCode: string | null;
  pharmacyId: string | null;
  reason: FeedbackReason;
  until: DayKey | null;
  createdOn: DayKey;
};

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  accepted: "Accepté",
  other_sector: "Je préfère un autre secteur ce jour-là",
  not_field_day: "Pas de terrain ce jour-là",
  client_unavailable_weekday: "La cliente ne reçoit pas ce jour de la semaine",
  too_soon: "Trop tôt, à reporter",
  day_too_full: "Journée trop chargée",
  other: "Autre raison",
};

export type Learning = {
  /** Jour ISO → département → facteur multiplicatif (0,3 à 2) */
  sectorFactor: Record<number, Record<string, number>>;
  /** Jours ISO où l'assistant ne propose plus de terrain (refus répétés) */
  avoidWeekdays: Set<number>;
  clientAvoidWeekdays: Map<string, Set<number>>;
  clientSnoozedUntil: Map<string, DayKey>;
  /** Ajustement du nombre de visites par journée (négatif si les journées proposées sont jugées trop chargées) */
  capacityDelta: number;
  accepted: number;
  rejected: number;
  insights: string[];
};

const HALF_LIFE_DAYS = 90;

export function learnFromFeedback(feedback: AssistantFeedback[], today: DayKey, labels: (code: string) => string, weekdayLabel: (wd: number) => string): Learning {
  const weight = (f: AssistantFeedback) => 0.5 ** (Math.max(0, diffDays(f.createdOn, today)) / HALF_LIFE_DAYS);
  const net: Record<number, Record<string, number>> = {};
  const notField: Record<number, number> = {};
  const clientAvoid = new Map<string, Set<number>>();
  const snoozed = new Map<string, DayKey>();
  let tooFull = 0;
  let accepted = 0;
  let rejected = 0;
  for (const f of feedback) {
    const w = weight(f);
    if (f.action === "accepted") accepted++;
    else rejected++;
    if (f.kind === "day" && f.weekday && f.departmentCode) {
      net[f.weekday] ??= {};
      if (f.action === "accepted") net[f.weekday]![f.departmentCode] = (net[f.weekday]![f.departmentCode] ?? 0) + w;
      else if (f.reason === "other_sector") net[f.weekday]![f.departmentCode] = (net[f.weekday]![f.departmentCode] ?? 0) - w;
      else if (f.reason === "not_field_day") notField[f.weekday] = (notField[f.weekday] ?? 0) + w;
      else if (f.reason === "day_too_full") tooFull += w;
    }
    if (f.kind === "client_day" && f.pharmacyId) {
      if (f.reason === "client_unavailable_weekday" && f.weekday) {
        const set = clientAvoid.get(f.pharmacyId) ?? new Set<number>();
        set.add(f.weekday);
        clientAvoid.set(f.pharmacyId, set);
      }
      if (f.reason === "day_too_full") tooFull += w;
    }
    if ((f.kind === "client_snooze" || f.reason === "too_soon") && f.pharmacyId && f.until) {
      if (!snoozed.has(f.pharmacyId) || snoozed.get(f.pharmacyId)! < f.until) snoozed.set(f.pharmacyId, f.until);
    }
  }
  const sectorFactor: Learning["sectorFactor"] = {};
  const insights: string[] = [];
  for (const [wd, deps] of Object.entries(net)) {
    sectorFactor[Number(wd)] = {};
    for (const [dep, v] of Object.entries(deps)) {
      const factor = Math.min(2, Math.max(0.3, Math.exp(0.45 * v)));
      sectorFactor[Number(wd)]![dep] = factor;
      if (v <= -1.5) insights.push(`Vous refusez souvent ${labels(dep)} le ${weekdayLabel(Number(wd))} : je le propose moins.`);
      else if (v >= 1.5) insights.push(`Vous acceptez volontiers ${labels(dep)} le ${weekdayLabel(Number(wd))} : je le privilégie.`);
    }
  }
  const avoidWeekdays = new Set(Object.entries(notField).filter(([, v]) => v >= 2.5).map(([wd]) => Number(wd)));
  for (const wd of avoidWeekdays) insights.push(`Le ${weekdayLabel(wd)} n'est souvent pas un jour de terrain : je ne le remplis plus.`);
  const capacityDelta = -Math.min(2, Math.floor(tooFull / 2) * 0.5);
  if (capacityDelta < 0) insights.push(`Mes journées vous semblent trop chargées : je propose ${-capacityDelta} visite(s) de moins par jour.`);
  for (const [, days] of clientAvoid) if (days.size) insights.push(`${clientAvoid.size} cliente(s) ne reçoivent pas certains jours : j'en tiens compte.`);
  if (snoozed.size) insights.push(`${snoozed.size} cliente(s) reportée(s) à plus tard.`);
  return { sectorFactor, avoidWeekdays, clientAvoidWeekdays: clientAvoid, clientSnoozedUntil: snoozed, capacityDelta, accepted, rejected, insights: [...new Set(insights)] };
}
