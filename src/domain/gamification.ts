/**
 * Récompenses symboliques (facultatives) : points, niveaux, badges, défis de la
 * semaine et série douce. Tout est recalculé à partir des données : rien n'est
 * stocké, rien n'est truqué, et les règles favorisent la qualité du suivi et des
 * journées équilibrées plutôt que le nombre brut de rendez-vous.
 */
import type { Category } from "./frequency";
import { addDays, isoWeekday, startOfIsoWeek, type DayKey } from "./time";

export type RewardFacts = {
  today: DayKey;
  doneVisits: { day: DayKey; pharmacyId: string; category: Category | null; departmentCode: string | null; rescued: boolean }[];
  reports: { day: DayKey }[];
  manualValidations: number;
  calendarImports: number;
  kmSaved: number;
  plansApplied: number;
  pharmacies: { total: number; geolocated: number; categorized: number };
  visitedDepartments: string[];
  /** Jours ouvrés passés (et aujourd'hui) ayant au moins une visite */
  workdays: { day: DayKey; visits: number; closedVisits: number; balanced: boolean }[];
};

export const POINTS = {
  visitDone: 10,
  report: 5,
  manualValidation: 2,
  firstImport: 20,
  perKmSaved: 1,
  balancedDay: 15,
  rescue: 5,
} as const;

export const LEVELS: { name: string; min: number }[] = [
  { name: "Graine", min: 0 },
  { name: "Pousse", min: 100 },
  { name: "Bourgeon", min: 300 },
  { name: "Fleur", min: 600 },
  { name: "Bouquet", min: 1000 },
  { name: "Jardin", min: 1600 },
  { name: "Forêt", min: 2500 },
  { name: "Légende", min: 4000 },
];

export type BadgeColor = "mint" | "peach" | "lilac" | "butter" | "pink" | "sky";

export type Badge = {
  key: string;
  name: string;
  description: string;
  icon: "footprints" | "archive" | "search" | "map" | "tags" | "pen" | "flame" | "leaf" | "compass" | "sun" | "heart" | "trophy";
  color: BadgeColor;
  value: number;
  target: number;
  unlocked: boolean;
};

export type Challenge = { key: string; label: string; value: number; target: number; done: boolean; color: BadgeColor };

export type Rewards = {
  points: number;
  todayPoints: number;
  breakdown: { label: string; points: number }[];
  level: { index: number; name: string; min: number; nextName: string | null; nextMin: number | null; progress: number };
  badges: Badge[];
  streak: { current: number; best: number };
  challenges: Challenge[];
};

const isClosed = (d: { visits: number; closedVisits: number }) => d.visits > 0 && d.closedVisits >= d.visits;

export function computeRewards(f: RewardFacts): Rewards {
  const balancedClosed = f.workdays.filter((d) => d.balanced && isClosed(d) && d.day <= f.today);
  const rescues = f.doneVisits.filter((v) => v.rescued);
  const kmPoints = Math.max(0, Math.round(f.kmSaved)) * POINTS.perKmSaved;
  const breakdown = [
    { label: "Visites réalisées", points: f.doneVisits.length * POINTS.visitDone },
    { label: "Comptes rendus", points: f.reports.length * POINTS.report },
    { label: "Pharmacies retrouvées après un retard", points: rescues.length * POINTS.rescue },
    { label: "Journées équilibrées et clôturées", points: balancedClosed.length * POINTS.balancedDay },
    { label: "Rapprochements vérifiés", points: f.manualValidations * POINTS.manualValidation },
    { label: "Kilomètres économisés", points: kmPoints },
    { label: "Premier import de l'agenda", points: f.calendarImports > 0 ? POINTS.firstImport : 0 },
  ];
  const points = breakdown.reduce((n, b) => n + b.points, 0);

  const todayDone = f.doneVisits.filter((v) => v.day === f.today);
  const todayEntry = f.workdays.find((d) => d.day === f.today);
  const todayPoints =
    todayDone.length * POINTS.visitDone +
    todayDone.filter((v) => v.rescued).length * POINTS.rescue +
    f.reports.filter((r) => r.day === f.today).length * POINTS.report +
    (todayEntry && todayEntry.balanced && isClosed(todayEntry) ? POINTS.balancedDay : 0);

  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i]!.min) index = i;
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1] ?? null;
  const level = {
    index,
    name: current.name,
    min: current.min,
    nextName: next?.name ?? null,
    nextMin: next?.min ?? null,
    progress: next ? (points - current.min) / (next.min - current.min) : 1,
  };

  const streak = computeStreak(f.workdays, f.today);

  const yearPrefix = f.today.slice(0, 4);
  const aVisits = new Map<string, number>();
  for (const v of f.doneVisits) {
    if (v.category === "A" && v.day.startsWith(yearPrefix)) aVisits.set(v.pharmacyId, (aVisits.get(v.pharmacyId) ?? 0) + 1);
  }
  const bestA = Math.max(0, ...aVisits.values());
  const pharmaciesReady = f.pharmacies.total >= 10;
  const badge = (b: Omit<Badge, "unlocked">): Badge => ({ ...b, value: Math.min(b.value, b.target), unlocked: b.value >= b.target });
  const badges: Badge[] = [
    badge({ key: "first-visit", name: "Premier pas", description: "Clôturer une première visite avec « Rendez-vous terminé »", icon: "footprints", color: "mint", value: f.doneVisits.length, target: 1 }),
    badge({ key: "archivist", name: "Archiviste", description: "Importer son agenda Outlook", icon: "archive", color: "sky", value: f.calendarImports, target: 1 }),
    badge({ key: "detective", name: "Détective", description: "Vérifier 25 rapprochements à la main", icon: "search", color: "lilac", value: f.manualValidations, target: 25 }),
    badge({ key: "cartographer", name: "Cartographe", description: "Géolocaliser toutes les pharmacies (10 minimum)", icon: "map", color: "butter", value: pharmaciesReady ? f.pharmacies.geolocated : 0, target: Math.max(10, f.pharmacies.total) }),
    badge({ key: "librarian", name: "Classeuse", description: "Attribuer une catégorie A–D à toutes les pharmacies (10 minimum)", icon: "tags", color: "peach", value: pharmaciesReady ? f.pharmacies.categorized : 0, target: Math.max(10, f.pharmacies.total) }),
    badge({ key: "writer", name: "Plume", description: "Rédiger 10 comptes rendus de visite", icon: "pen", color: "pink", value: f.reports.length, target: 10 }),
    badge({ key: "steady", name: "Régulière", description: "Clôturer 5 journées de visites d'affilée", icon: "flame", color: "peach", value: streak.best, target: 5 }),
    badge({ key: "saver", name: "Économe", description: "Économiser 50 km grâce aux tournées optimisées", icon: "leaf", color: "mint", value: Math.round(f.kmSaved), target: 50 }),
    badge({ key: "explorer", name: "Exploratrice", description: "Visiter des pharmacies dans 5 départements", icon: "compass", color: "sky", value: f.visitedDepartments.length, target: 5 }),
    badge({ key: "zen", name: "Zen", description: "Vivre 5 journées équilibrées et clôturées", icon: "sun", color: "butter", value: balancedClosed.length, target: 5 }),
    badge({ key: "loyal", name: "Fidèle", description: "Voir 4 fois dans l'année une même pharmacie A", icon: "heart", color: "pink", value: bestA, target: 4 }),
    badge({ key: "centurion", name: "Centurion", description: "Réaliser 100 visites", icon: "trophy", color: "lilac", value: f.doneVisits.length, target: 100 }),
  ];

  const weekStart = startOfIsoWeek(f.today);
  const inWeek = (day: DayKey) => day >= weekStart && day <= f.today;
  const weekDays = f.workdays.filter((d) => inWeek(d.day));
  const weekVisits = weekDays.reduce((n, d) => n + d.visits, 0);
  const weekClosed = weekDays.reduce((n, d) => n + Math.min(d.closedVisits, d.visits), 0);
  const challenge = (c: Omit<Challenge, "done">): Challenge => ({ ...c, value: Math.min(c.value, c.target), done: c.value >= c.target });
  const challenges = [
    challenge({ key: "close-week", label: "Clôturer toutes les visites de la semaine", value: weekClosed, target: Math.max(1, weekVisits), color: "mint" }),
    challenge({ key: "rescue", label: "Retrouver 2 pharmacies qui vous attendaient", value: f.doneVisits.filter((v) => v.rescued && inWeek(v.day)).length, target: 2, color: "pink" }),
    challenge({ key: "reports", label: "Écrire 3 comptes rendus", value: f.reports.filter((r) => inWeek(r.day)).length, target: 3, color: "lilac" }),
    challenge({ key: "balanced", label: "Vivre une journée idéale (équilibrée et clôturée)", value: weekDays.filter((d) => d.balanced && isClosed(d)).length, target: 1, color: "butter" }),
  ];

  return { points, todayPoints, breakdown, level, badges, streak, challenges };
}

/**
 * Série douce : journées de visites consécutives entièrement clôturées. Les jours
 * sans visite (week-ends, congés, journées libres) ne cassent pas la série ; la
 * journée en cours non terminée non plus.
 */
export function computeStreak(workdays: RewardFacts["workdays"], today: DayKey): { current: number; best: number } {
  const days = workdays.filter((d) => d.visits > 0 && d.day <= today).sort((a, b) => a.day.localeCompare(b.day));
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (isClosed(d)) {
      run++;
      best = Math.max(best, run);
    } else if (d.day !== today) {
      run = 0;
    }
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (isClosed(d)) current++;
    else if (d.day === today) continue;
    else break;
  }
  return { current, best };
}

/** Message d'encouragement doux (jamais culpabilisant). */
export function encouragement(r: Rewards): string {
  if (r.todayPoints > 0) return `+${r.todayPoints} points aujourd'hui, bravo !`;
  if (r.streak.current >= 3) return `${r.streak.current} journées clôturées d'affilée, belle régularité.`;
  const next = r.challenges.find((c) => !c.done && c.value > 0);
  if (next) return `Défi en cours : ${next.label.toLowerCase()} (${next.value}/${next.target}).`;
  return "Chaque visite clôturée fait grandir votre jardin.";
}

/** Jours ouvrés d'une période (utilitaire pour construire les faits). */
export function workdaysBetween(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5) out.push(d);
  return out;
}
