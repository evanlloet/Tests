/**
 * Utilitaires de date. Les instants sont stockés en UTC (timestamptz) ; les règles
 * métier (journées, horaires de travail, jours de semaine) s'appliquent dans le
 * fuseau de l'utilisatrice (Europe/Paris par défaut).
 */
import { TZDate } from "@date-fns/tz";

export const DEFAULT_TZ = "Europe/Paris";

/** Jour calendaire au format AAAA-MM-JJ, sans fuseau. */
export type DayKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function isDayKey(value: string): value is DayKey {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Jour local (dans `tz`) d'un instant. */
export function dayKeyOf(date: Date, tz = DEFAULT_TZ): DayKey {
  const d = new TZDate(date.getTime(), tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Instant correspondant à une heure murale « HH:mm[:ss] » d'un jour local. */
export function zonedDateTime(day: DayKey, hhmm: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h = 0, mi = 0, s = 0] = hhmm.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, h, mi, s, tz).getTime());
}

/** Heure murale « HH:mm » d'un instant dans `tz`. */
export function timeOfDay(date: Date, tz = DEFAULT_TZ): string {
  const d = new TZDate(date.getTime(), tz);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes depuis minuit (heure locale). */
export function minutesOfDay(date: Date, tz = DEFAULT_TZ): number {
  const d = new TZDate(date.getTime(), tz);
  return d.getHours() * 60 + d.getMinutes();
}

/** « 08:30 » → 510 */
export function parseHHmm(value: string): number {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHmm(minutes: number): string {
  const m = Math.round(minutes);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Jour ISO de la semaine : 1 = lundi … 7 = dimanche. */
export function isoWeekday(day: DayKey): number {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function addDays(day: DayKey, n: number): DayKey {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Nombre de jours de `a` à `b` (b − a). */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function startOfIsoWeek(day: DayKey): DayKey {
  return addDays(day, 1 - isoWeekday(day));
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

export const WEEKDAY_SHORT: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Jeu",
  5: "Ven",
  6: "Sam",
  7: "Dim",
};

const dateFormatter = (tz: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...options });

export function formatDayLong(day: DayKey): string {
  return dateFormatter("UTC", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export function formatDayShort(day: DayKey): string {
  return dateFormatter("UTC", { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export function formatDate(date: Date, tz = DEFAULT_TZ): string {
  return dateFormatter(tz, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(date: Date, tz = DEFAULT_TZ): string {
  return dateFormatter(tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    date,
  );
}

export function formatTime(date: Date, tz = DEFAULT_TZ): string {
  return timeOfDay(date, tz);
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${pad(r)}` : `${h} h`;
}
