/**
 * Génère un AGENDA OUTLOOK FICTIF (.ics) à partir d'un fichier clients (Excel ou CSV),
 * pour essayer Léa (rapprochement, historique, planning, tournées) avant d'importer
 * le vrai agenda. Les rendez-vous sont INVENTÉS : à importer de préférence dans un
 * compte de test, pas dans le compte réel.
 *
 * Règles de génération :
 *  - ~2 ans d'historique et 6 semaines à venir ;
 *  - jours par secteur sur un cycle de 3 semaines : lun/mar Calvados, mer/jeu Manche,
 *    ven Ille-et-Vilaine ; 1 semaine sur 3 (semaine « variante » de Léa) : lun/mar Orne,
 *    mer Manche, jeu Mayenne, ven Ille-et-Vilaine ;
 *  - fréquence selon la catégorie (A/B/C : 4 par an, D : 3 par an), avec de l'aléa ;
 *  - chaque journée regroupe des clientes proches (même zone ou communes voisines),
 *    mais dans l'ordre où elles auraient été saisies, pas forcément le plus court ;
 *  - la « date de prochaine visite » du fichier est respectée quand elle tombe dans
 *    les 6 semaines à venir ;
 *  - congés, jours fériés, réunions, quelques annulations et rendez-vous à confirmer.
 *
 * Usage : npm run agenda:fictif -- <fichier clients .xlsx ou .csv> [sortie.ics]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodeTextFile } from "../src/domain/calendar/decode";
import { locateCommune } from "../src/domain/communes";
import { DEFAULT_FREQUENCIES } from "../src/domain/frequency";
import { frenchPublicHolidays } from "../src/domain/holidays";
import { parsePharmacyFile, type PharmacyImportRow } from "../src/domain/pharmacy-import";
import { addDays, dayKeyOf, isoWeekday, zonedDateTime, type DayKey } from "../src/domain/time";

const [input, output = "agenda-fictif.ics"] = process.argv.slice(2);
if (!input) {
  console.error("Usage : npm run agenda:fictif -- <fichier clients .xlsx ou .csv> [sortie.ics]");
  process.exit(1);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même fichier → même agenda. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261013);
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;

const parsed = parsePharmacyFile(new Uint8Array(readFileSync(input)), (b) => decodeTextFile(b).text);

type Client = {
  row: PharmacyImportRow;
  sector: string;
  city: string;
  lat: number | null;
  lng: number | null;
  interval: number;
  last: DayKey | null;
  next: DayKey;
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
const today = dayKeyOf(new Date());
const start = addDays(today, -730);
const end = addDays(today, 42);

const clients: Client[] = parsed.rows.map((row) => {
  // Le secteur suit la zone commerciale (UGA) quand elle existe : c'est l'organisation réelle des tournées.
  const sector = row.salesZone?.match(/^\d\d/)?.[0] ?? row.departmentCode ?? "";
  const place = locateCommune(row.postalCode, row.city);
  const perYear = row.targetVisitsPerYear ?? DEFAULT_FREQUENCIES[row.category ?? "C"];
  const interval = Math.round(365 / perYear);
  // Historique décalé : chaque cliente démarre à un moment différent de son cycle
  const first = addDays(start, Math.floor(rand() * interval));
  return { row, sector, city: place?.name ?? titleCase(row.city ?? ""), lat: place?.lat ?? null, lng: place?.lng ?? null, interval, last: null, next: first };
});
// Positions manquantes (commune inconnue) : centre des autres clientes de la même zone
for (const c of clients.filter((c) => c.lat === null)) {
  const same = clients.filter((o) => o.lat !== null && o.row.salesZone === c.row.salesZone);
  if (same.length) {
    c.lat = same.reduce((s, o) => s + o.lat!, 0) / same.length;
    c.lng = same.reduce((s, o) => s + o.lng!, 0) / same.length;
  }
}

const MAIN: Record<number, string[]> = { 1: ["14"], 2: ["14"], 3: ["50"], 4: ["50"], 5: ["35"] };
const VARIANT: Record<number, string[]> = { 1: ["61", "72", "28"], 2: ["61", "72", "28"], 3: ["50"], 4: ["53"], 5: ["35"] };
const HOLIDAYS = new Map<DayKey, string>();
for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) for (const [d, n] of frenchPublicHolidays(y)) HOLIDAYS.set(d, n);
const VACATIONS: [DayKey, DayKey][] = [];
for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
  VACATIONS.push([`${y}-08-03`, `${y}-08-16`], [`${y}-12-22`, `${y + 1}-01-02`]);
}
const onVacation = (d: DayKey) => VACATIONS.some(([a, b]) => d >= a && d <= b);
const distance = (a: Client, b: Client) =>
  a.lat === null || b.lat === null ? 99 : Math.hypot(a.lat - b.lat, (a.lng! - b.lng!) * Math.cos((a.lat * Math.PI) / 180)) * 111;

const SLOTS = ["09:00", "10:15", "11:30", "14:00", "15:15", "16:30"];
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const events: string[] = [];
let uid = 0;
const stamp = utc(new Date());
const push = (summary: string, dtstart: string, dtend: string, extra: string[] = []) =>
  events.push(["BEGIN:VEVENT", `UID:lea-agenda-fictif-${uid++}@exemple.invalid`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(summary)}`, dtstart, dtend, ...extra, "END:VEVENT"].join("\r\n"));

/** Titre tel qu'une commerciale pourrait le saisir dans Outlook (variantes volontaires). */
function title(c: Client): string {
  const name = c.row.name;
  const short = name.replace(/^(Grande )?Pharmacie /, "Phie ");
  const r = rand();
  if (r < 0.55) return `RDV ${name}`;
  if (r < 0.75) return `${name} - ${c.city}`;
  if (r < 0.87) return `Visite ${short}`;
  if (r < 0.95) return name;
  return `rdv ${short.toLowerCase()} ${c.city.toLowerCase()}`;
}

let visits = 0;
for (let day = start; day <= end; day = addDays(day, 1)) {
  const dow = isoWeekday(day);
  if (dow > 5 || HOLIDAYS.has(day) || onVacation(day)) continue;
  const week = Math.floor((Date.parse(`${day}T00:00:00Z`) / 86_400_000 + 3) / 7);
  const sectors = (week % 3 === 2 ? VARIANT : MAIN)[dow]!;
  const future = day > today;

  // Clientes dues (ou presque) dans les secteurs du jour, les plus en retard d'abord ;
  // une date de prochaine visite du fichier, à venir, passe en priorité ce jour-là.
  const due = clients
    .filter((c) => sectors.includes(c.sector) && c.next <= addDays(day, 12) && (!c.last || c.last <= addDays(day, -Math.round(c.interval * 0.6))))
    .map((c) => ({ c, score: c.next.localeCompare(day) - (future && c.row.plannedVisitOn && Math.abs(Date.parse(c.row.plannedVisitOn) - Date.parse(day)) < 3 * 86_400_000 ? 1000 : 0) }))
    .sort((a, b) => a.score - b.score || a.c.next.localeCompare(b.c.next));
  if (!due.length) continue;
  const capacity = dow === 5 ? 4 : 4 + Math.floor(rand() * 3);
  const anchor = due[0]!.c;
  // Journée cohérente : la plus en retard, puis ses voisines dues
  const chosen = [anchor, ...due.slice(1).map((d) => d.c).sort((a, b) => distance(anchor, a) - distance(anchor, b)).filter((c) => distance(anchor, c) < 45)].slice(0, capacity);

  // Ordre de saisie : souvent celui des disponibilités des pharmaciens, pas le plus court
  if (rand() < 0.6) chosen.sort(() => rand() - 0.5);
  else chosen.sort((a, b) => (b.lat ?? 0) - (a.lat ?? 0));
  chosen.forEach((c, i) => {
    const minutes = pick([45, 45, 45, 30, 60]);
    const s = zonedDateTime(day, SLOTS[i]!);
    const e = new Date(s.getTime() + minutes * 60_000);
    const extra: string[] = [];
    if (rand() < 0.7) extra.push(`LOCATION:${esc(c.city)}`);
    if (rand() < 0.03) extra.push("STATUS:CANCELLED");
    else if (future && rand() < 0.12) extra.push("STATUS:TENTATIVE");
    push(title(c), `DTSTART:${utc(s)}`, `DTEND:${utc(e)}`, extra);
    c.last = day;
    c.next = addDays(day, c.interval + Math.round((rand() - 0.5) * 30));
    visits++;
  });
  // Un peu de vie de bureau, comme dans un vrai agenda
  if (dow === 5 && week % 2 === 0) push("Réunion d'équipe (Teams)", `DTSTART:${utc(zonedDateTime(day, "17:30"))}`, `DTEND:${utc(zonedDateTime(day, "18:15"))}`);
  if (rand() < 0.01) push("Formation produits", `DTSTART;VALUE=DATE:${day.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(day, 1).replace(/-/g, "")}`);
}
for (const [a, b] of VACATIONS) {
  if (b < start || a > end) continue;
  push("Congés", `DTSTART;VALUE=DATE:${a.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(b, 1).replace(/-/g, "")}`);
}

writeFileSync(
  output,
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lea//Agenda fictif//FR", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Agenda fictif (Léa)", ...events, "END:VCALENDAR", ""].join("\r\n"),
);
const never = clients.filter((c) => !c.last).length;
console.log(`${visits} rendez-vous fictifs pour ${clients.length} clientes (${never} jamais visitée(s)), du ${start} au ${end} → ${output}`);
