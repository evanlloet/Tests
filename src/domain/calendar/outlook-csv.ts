/**
 * Lecture des exports CSV du calendrier Outlook (versions française et anglaise).
 *
 * Particularités gérées :
 * - en-têtes FR (« Objet », « Date de début »…) ou EN (« Subject », « Start Date »…) ;
 * - séparateur virgule ou point-virgule (fichier ré-enregistré par Excel) ;
 * - dates JJ/MM/AAAA, MM/JJ/AAAA (détection automatique) ou AAAA-MM-JJ ;
 * - heures 24 h ou AM/PM ;
 * - « Journée entière » : Vrai/Faux, True/False.
 * Les horaires sont interprétés dans le fuseau de l'utilisatrice (le CSV n'en contient pas).
 */
import Papa from "papaparse";
import { normalizeText } from "../text";
import { addDays, DEFAULT_TZ, zonedDateTime, type DayKey } from "../time";
import { csvSourceKey, eventContentHash } from "./keys";
import type { CalendarParseResult, ParsedCalendarEvent } from "./types";

type Field = "title" | "startDate" | "startTime" | "endDate" | "endTime" | "allDay" | "location" | "description" | "categories" | "showAs";

const FIELD_ALIASES: Record<Field, string[]> = {
  title: ["objet", "subject", "titre", "sujet"],
  startDate: ["date de debut", "start date", "date debut", "debut", "start"],
  startTime: ["heure de debut", "start time", "heure debut"],
  endDate: ["date de fin", "end date", "date fin", "fin", "end"],
  endTime: ["heure de fin", "end time", "heure fin"],
  allDay: ["journee entiere", "all day event", "evenement d une journee", "toute la journee", "all day"],
  location: ["emplacement", "location", "lieu"],
  description: ["description", "notes", "corps du message", "body"],
  categories: ["categories", "categorie"],
  showAs: ["afficher la disponibilite", "show time as", "disponibilite"],
};

const FRENCH_HEADER_HINTS = ["objet", "date de debut", "emplacement", "journee entiere"];

export type DateOrder = "dmy" | "mdy";

export function looksLikeOutlookCsv(text: string): boolean {
  const firstLine = normalizeText(text.split(/\r?\n/, 1)[0] ?? "");
  return (
    (firstLine.includes("objet") || firstLine.includes("subject")) &&
    (firstLine.includes("date de debut") || firstLine.includes("start date") || firstLine.includes("debut"))
  );
}

export function parseOutlookCsv(text: string, options: { timezone?: string; dateOrder?: DateOrder } = {}): CalendarParseResult {
  const tz = options.timezone ?? DEFAULT_TZ;
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t"],
  });
  for (const err of parsed.errors.slice(0, 20)) {
    warnings.push(`Ligne ${(err.row ?? 0) + 2} : ${err.message}`);
  }

  const headers = parsed.meta.fields ?? [];
  const columns = mapColumns(headers);
  if (!columns.title || !columns.startDate) {
    throw new CalendarFormatError(
      "Colonnes « Objet » et « Date de début » introuvables. Exportez le calendrier depuis Outlook au format CSV (Fichier › Ouvrir et exporter › Importer/Exporter).",
    );
  }
  const isFrench = headers.some((h) => FRENCH_HEADER_HINTS.includes(normalizeText(h)));
  const rows = parsed.data;
  const dateValues = rows.flatMap((r) => [cell(r, columns.startDate), cell(r, columns.endDate)]).filter(Boolean);
  const detected = detectDateOrder(dateValues);
  const dateOrder: DateOrder = options.dateOrder ?? detected ?? (isFrench ? "dmy" : "mdy");
  if (!options.dateOrder && !detected) {
    warnings.push(
      `Format des dates ambigu : interprété en ${dateOrder === "dmy" ? "JJ/MM/AAAA" : "MM/JJ/AAAA"} d'après la langue des en-têtes.`,
    );
  }

  const events: ParsedCalendarEvent[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const title = cell(row, columns.title).trim();
    const startDateRaw = cell(row, columns.startDate);
    if (!title && !startDateRaw) return;
    if (!title) {
      warnings.push(`Ligne ${line} : événement sans objet, ignoré.`);
      return;
    }

    const allDay = parseBoolean(cell(row, columns.allDay));
    const start = parseDateTimeCell(startDateRaw, cell(row, columns.startTime), dateOrder);
    if (!start) {
      warnings.push(`Ligne ${line} (« ${title} ») : date de début illisible « ${startDateRaw} », ignorée.`);
      return;
    }
    const endParsed = parseDateTimeCell(cell(row, columns.endDate) || startDateRaw, cell(row, columns.endTime), dateOrder);

    let startAt: Date;
    let endAt: Date;
    if (allDay) {
      startAt = zonedDateTime(start.day, "00:00", tz);
      let endDay = endParsed?.day ?? addDays(start.day, 1);
      if (endDay <= start.day) endDay = addDays(start.day, 1);
      endAt = zonedDateTime(endDay, "00:00", tz);
    } else {
      if (!start.time) {
        warnings.push(`Ligne ${line} (« ${title} ») : heure de début absente, ignorée.`);
        return;
      }
      startAt = zonedDateTime(start.day, start.time, tz);
      if (!endParsed?.time) {
        warnings.push(`Ligne ${line} (« ${title} ») : heure de fin absente, ignorée.`);
        return;
      }
      endAt = zonedDateTime(endParsed.day, endParsed.time, tz);
      if (endAt < startAt) {
        warnings.push(`Ligne ${line} (« ${title} ») : fin antérieure au début, ignorée.`);
        return;
      }
    }

    const location = cell(row, columns.location).trim() || null;
    const description = cell(row, columns.description).trim() || null;
    events.push({
      sourceKey: csvSourceKey(title, startAt, endAt, location),
      contentHash: eventContentHash(title, startAt, endAt),
      uid: null,
      recurrenceId: null,
      title,
      description,
      location,
      start: startAt,
      end: endAt,
      allDay,
      sourceTimezone: tz,
      isCancelled: isCancelledTitle(title),
      isRecurring: false,
      raw: { format: "outlook_csv", line, row },
    });
  });

  return { format: "outlook_csv", events, warnings, sourceEntries: rows.length };
}

export class CalendarFormatError extends Error {}

/** Titres préfixés par Outlook lors d'une annulation. */
export function isCancelledTitle(title: string): boolean {
  return /^\s*(annul[ée]e?s?|canceled|cancelled|annulation)\s*[:\-–]/i.test(title);
}

function mapColumns(headers: string[]): Partial<Record<Field, string>> {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeText(h) }));
  const out: Partial<Record<Field, string>> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
    for (const alias of aliases) {
      const hit = normalized.find((h) => h.norm === alias);
      if (hit) {
        out[field] = hit.raw;
        break;
      }
    }
  }
  return out;
}

function cell(row: Record<string, string>, column: string | undefined): string {
  if (!column) return "";
  const v = row[column];
  return typeof v === "string" ? v : "";
}

function parseBoolean(value: string): boolean {
  return ["vrai", "true", "oui", "yes", "1"].includes(normalizeText(value));
}

/**
 * Détermine l'ordre jour/mois à partir des valeurs : une première composante > 12
 * impose JJ/MM, une seconde composante > 12 impose MM/JJ. Null si indécidable.
 */
export function detectDateOrder(values: string[]): DateOrder | null {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  if (dmy && !mdy) return "dmy";
  if (mdy && !dmy) return "mdy";
  return null;
}

type DateTimeCell = { day: DayKey; time: string | null };

/** Lit une date (et éventuellement une heure dans la même cellule ou une cellule séparée). */
export function parseDateTimeCell(dateCell: string, timeCell: string, order: DateOrder): DateTimeCell | null {
  const raw = dateCell.trim();
  if (!raw) return null;
  let datePart = raw;
  let timePart = timeCell.trim();
  const split = raw.match(/^(\S+)[ T](.+)$/);
  if (split && !timePart) {
    datePart = split[1]!;
    timePart = split[2]!;
  } else if (split) {
    datePart = split[1]!;
  }

  const day = parseDatePart(datePart, order);
  if (!day) return null;
  const time = timePart ? parseTimePart(timePart) : null;
  if (timePart && !time) return null;
  return { day, time };
}

function parseDatePart(value: string, order: DateOrder): DayKey | null {
  let y: number;
  let mo: number;
  let d: number;
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const local = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else if (local) {
    const a = Number(local[1]);
    const b = Number(local[2]);
    y = Number(local[3]);
    if (y < 100) y += 2000;
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== d) return null;
  return key;
}

function parseTimePart(value: string): string | null {
  const m = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})[:hH](\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[4];
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
