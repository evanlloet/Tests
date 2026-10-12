/**
 * Lecture des fichiers ICS (export Outlook, Google Agenda, etc.).
 *
 * - Fuseaux : TZID IANA, noms Windows d'Outlook (« Romance Standard Time ») ou
 *   définitions VTIMEZONE du fichier. Les fuseaux sont résolus localement,
 *   sans registre global partagé entre utilisateurs.
 * - Récurrences : expansion bornée à une fenêtre de dates, exceptions
 *   (RECURRENCE-ID) et dates exclues (EXDATE) prises en compte.
 * - Annulations : STATUS:CANCELLED ou titre préfixé « Annulé : ».
 */
import ICAL from "ical.js";
import { TZDate } from "@date-fns/tz";
import { DEFAULT_TZ, zonedDateTime } from "../time";
import { eventContentHash, icsSourceKey } from "./keys";
import { CalendarFormatError, isCancelledTitle } from "./outlook-csv";
import type { CalendarParseResult, ParsedCalendarEvent } from "./types";

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalTimezone = InstanceType<typeof ICAL.Timezone>;

/** Principaux fuseaux Windows rencontrés dans les exports Outlook. */
const WINDOWS_TIMEZONES: Record<string, string> = {
  "Romance Standard Time": "Europe/Paris",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kyiv",
  "GTB Standard Time": "Europe/Bucharest",
  "Morocco Standard Time": "Africa/Casablanca",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Reunion Standard Time": "Indian/Reunion",
  "SA Western Standard Time": "America/La_Paz",
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
};

export const MAX_OCCURRENCES_PER_SERIES = 3000;

export type IcsParseOptions = {
  timezone?: string;
  /** Fenêtre d'expansion des récurrences */
  windowStart: Date;
  windowEnd: Date;
};

export function looksLikeIcs(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));
}

export function parseIcs(text: string, options: IcsParseOptions): CalendarParseResult {
  const userTz = options.timezone ?? DEFAULT_TZ;
  const warnings: string[] = [];
  let root: IcalComponent;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    throw new CalendarFormatError(`Fichier ICS illisible : ${(err as Error).message}`);
  }

  const localZones = new Map<string, IcalTimezone>();
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      const zone = new ICAL.Timezone(vtz);
      if (zone.tzid) localZones.set(zone.tzid, zone);
    } catch {
      warnings.push("Une définition de fuseau horaire (VTIMEZONE) est illisible.");
    }
  }
  const floatingWarned = new Set<string>();
  const toDate = (t: IcalTime): Date => {
    const res = icalTimeToDate(t, userTz, localZones);
    if (res.floating && !floatingWarned.has(res.floating)) {
      floatingWarned.add(res.floating);
      warnings.push(`Fuseau « ${res.floating} » inconnu : horaires interprétés en heure de ${userTz}.`);
    }
    return res.date;
  };

  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, IcalEvent>();
  const exceptions: IcalEvent[] = [];
  for (const comp of vevents) {
    const ev = new ICAL.Event(comp);
    if (!ev.uid) {
      warnings.push(`Événement « ${ev.summary ?? "sans titre"} » sans UID, ignoré.`);
      continue;
    }
    if (comp.hasProperty("recurrence-id")) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  // Rattache les occurrences modifiées à leur série
  const orphanExceptions: IcalEvent[] = [];
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master && master.isRecurring()) master.relateException(ex);
    else orphanExceptions.push(ex);
  }

  const events: ParsedCalendarEvent[] = [];
  const windowStart = options.windowStart.getTime();
  const windowEnd = options.windowEnd.getTime();

  const pushOccurrence = (
    item: IcalEvent,
    start: IcalTime,
    end: IcalTime | null,
    recurrenceId: string | null,
    isRecurring: boolean,
    master: IcalEvent,
  ) => {
    const allDay = start.isDate;
    const startAt = allDay ? zonedDateTime(dayKeyFromIcal(start), "00:00", userTz) : toDate(start);
    let endAt: Date;
    if (end) {
      endAt = end.isDate ? zonedDateTime(dayKeyFromIcal(end), "00:00", userTz) : toDate(end);
    } else if (allDay) {
      endAt = new Date(startAt.getTime() + 24 * 3600_000);
    } else {
      endAt = startAt;
    }
    if (endAt < startAt) endAt = startAt;
    const title = (item.summary ?? "").trim() || "(sans titre)";
    const status = String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase();
    events.push({
      sourceKey: icsSourceKey(master.uid, recurrenceId),
      contentHash: eventContentHash(title, startAt, endAt),
      uid: master.uid,
      recurrenceId,
      title,
      description: item.description?.trim() || null,
      location: item.location?.trim() || null,
      start: startAt,
      end: endAt,
      allDay,
      sourceTimezone: allDay ? userTz : (tzidOf(start) ?? null),
      isCancelled: status === "CANCELLED" || isCancelledTitle(title),
      isRecurring,
      raw: {
        format: "ics",
        vevent: item.component.toJSON(),
        ...(isRecurring ? { occurrence: start.toString() } : {}),
      },
    });
  };

  for (const master of masters.values()) {
    if (!master.startDate) {
      warnings.push(`Événement « ${master.summary ?? "sans titre"} » sans date de début, ignoré.`);
      continue;
    }
    if (!master.isRecurring()) {
      pushOccurrence(master, master.startDate, master.endDate ?? null, null, false, master);
      continue;
    }
    const it = master.iterator();
    let count = 0;
    let next: IcalTime | null;
    while ((next = it.next())) {
      if (++count > MAX_OCCURRENCES_PER_SERIES) {
        warnings.push(`Série « ${master.summary} » : plus de ${MAX_OCCURRENCES_PER_SERIES} occurrences, expansion arrêtée.`);
        break;
      }
      const occStart = toDateSafe(next, toDate);
      if (occStart > windowEnd) break;
      const details = master.getOccurrenceDetails(next);
      const detailStart = toDateSafe(details.startDate, toDate);
      if (detailStart < windowStart && occStart < windowStart) continue;
      if (detailStart > windowEnd) continue;
      const recurrenceId = toDate(details.recurrenceId).toISOString();
      pushOccurrence(details.item, details.startDate, details.endDate, recurrenceId, true, master);
    }
  }

  for (const ex of orphanExceptions) {
    if (!ex.startDate) continue;
    const recurrenceId = toDate(ex.recurrenceId).toISOString();
    pushOccurrence(ex, ex.startDate, ex.endDate ?? null, recurrenceId, true, ex);
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { format: "ics", events, warnings, sourceEntries: vevents.length };
}

function toDateSafe(t: IcalTime, toDate: (t: IcalTime) => Date): number {
  return t.isDate ? Date.UTC(t.year, t.month - 1, t.day) : toDate(t).getTime();
}

function dayKeyFromIcal(t: IcalTime): string {
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

function tzidOf(t: IcalTime): string | undefined {
  // `timezone` (TZID brut) existe à l'exécution mais n'est pas déclaré dans les types d'ical.js
  const raw = (t as unknown as { timezone?: string }).timezone;
  const zone = t.zone as { tzid?: string } | undefined;
  return raw || zone?.tzid || undefined;
}

export function resolveIanaTimezone(tzid: string): string | null {
  const cleaned = tzid.replace(/^\/+/, "").trim();
  if (WINDOWS_TIMEZONES[cleaned]) return WINDOWS_TIMEZONES[cleaned]!;
  if (/paris/i.test(cleaned)) return "Europe/Paris";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: cleaned });
    return cleaned;
  } catch {
    return null;
  }
}

/** Convertit une heure ICS en instant UTC. */
export function icalTimeToDate(
  t: IcalTime,
  userTz: string,
  localZones: Map<string, IcalTimezone>,
): { date: Date; floating: string | null } {
  const tzid = tzidOf(t);
  if (tzid === "UTC" || tzid === "Z" || t.zone === ICAL.Timezone.utcTimezone) {
    return { date: new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)), floating: null };
  }
  if (tzid && tzid !== "floating") {
    const iana = resolveIanaTimezone(tzid);
    if (iana) {
      return {
        date: new Date(new TZDate(t.year, t.month - 1, t.day, t.hour, t.minute, t.second, iana).getTime()),
        floating: null,
      };
    }
    const zone = localZones.get(tzid);
    if (zone) {
      const offsetSeconds = zone.utcOffset(t);
      return {
        date: new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - offsetSeconds * 1000),
        floating: null,
      };
    }
  }
  // Heure « flottante » : interprétée dans le fuseau de l'utilisatrice
  return {
    date: new Date(new TZDate(t.year, t.month - 1, t.day, t.hour, t.minute, t.second, userTz).getTime()),
    floating: tzid && tzid !== "floating" ? tzid : null,
  };
}
