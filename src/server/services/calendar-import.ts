import "server-only";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { classifyEvent } from "@/domain/calendar/classify";
import { decodeTextFile } from "@/domain/calendar/decode";
import { looksLikeIcs, parseIcs } from "@/domain/calendar/ics";
import { sha256 } from "@/domain/calendar/keys";
import { CalendarFormatError, looksLikeOutlookCsv, parseOutlookCsv } from "@/domain/calendar/outlook-csv";
import type { CalendarParseResult, ParsedCalendarEvent } from "@/domain/calendar/types";
import { applyDayConsensus, applyDayContext, buildMatchIndex, decideMatch, scoreCandidates, type DayContext, type MatchIndex, type PharmacyGeo } from "@/domain/matching";
import { dayKeyOf } from "@/domain/time";
import type { Db, DbOrTx } from "../db/client";
import { appointmentMatches, appointments, calendarEvents, calendarImports, pharmacies, territories, type CalendarEvent } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { listForMatching } from "../repositories/pharmacies";
import { detectPhoneAppointments } from "./phone-review";

export type ImportUser = {
  id: string;
  timezone: string;
  autoMatchThreshold: number;
  defaultVisitMinutes: number;
};

export type CalendarImportSummary = {
  importId: string;
  format: "ics" | "outlook_csv";
  encoding: string;
  sourceEntries: number;
  totalEvents: number;
  newEvents: number;
  updatedEvents: number;
  unchangedEvents: number;
  duplicatesInFile: number;
  probableDuplicates: number;
  cancelled: number;
  classification: { visit: number; not_visit: number; unknown: number };
  matches: { auto_validated: number; pending: number; no_candidate: number };
  appointmentsCreated: number;
  appointmentsUpdated: number;
  /** Rendez-vous détectés comme téléphoniques, en attente de validation */
  phoneToReview: number;
  warnings: string[];
  firstDay: string | null;
  lastDay: string | null;
};

/** Fenêtre d'expansion des récurrences : 3 ans d'historique, 1 an à venir. */
export function recurrenceWindow(now = new Date()) {
  return {
    windowStart: new Date(now.getTime() - 3 * 365 * 86_400_000),
    windowEnd: new Date(now.getTime() + 365 * 86_400_000),
  };
}

export function parseCalendarFile(bytes: Uint8Array, timezone: string, now = new Date()): CalendarParseResult & { encoding: string } {
  const { text, encoding } = decodeTextFile(bytes);
  if (looksLikeIcs(text)) return { ...parseIcs(text, { timezone, ...recurrenceWindow(now) }), encoding };
  if (looksLikeOutlookCsv(text)) return { ...parseOutlookCsv(text, { timezone }), encoding };
  throw new CalendarFormatError(
    "Format non reconnu. Importez un fichier .ics (export du calendrier) ou un CSV exporté depuis Outlook.",
  );
}

export type CalendarPreview = {
  format: "ics" | "outlook_csv";
  encoding: string;
  sourceEntries: number;
  totalEvents: number;
  alreadyImported: number;
  probableDuplicates: number;
  duplicatesInFile: number;
  cancelled: number;
  allDay: number;
  classification: { visit: number; not_visit: number; unknown: number };
  firstDay: string | null;
  lastDay: string | null;
  futureEvents: number;
  warnings: string[];
  sample: { when: string; title: string; location: string | null; classification: string; reason: string; status: "nouveau" | "déjà importé" | "doublon probable" }[];
};

/** Prévisualisation : lecture, normalisation et classement, sans rien enregistrer. */
export async function previewCalendarFile(db: DbOrTx, user: ImportUser, bytes: Uint8Array, now = new Date()): Promise<CalendarPreview> {
  const parsed = parseCalendarFile(bytes, user.timezone, now);
  const seen = new Set<string>();
  const unique = parsed.events.filter((e) => (seen.has(e.sourceKey) ? false : (seen.add(e.sourceKey), true)));
  const known = new Set<string>();
  const knownHashes = new Set<string>();
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const byKey = await db
      .select({ k: calendarEvents.sourceKey })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.userId, user.id), inArray(calendarEvents.sourceKey, chunk.map((e) => e.sourceKey))));
    byKey.forEach((r) => known.add(r.k));
    const byHash = await db
      .select({ h: calendarEvents.contentHash })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.userId, user.id), inArray(calendarEvents.contentHash, chunk.map((e) => e.contentHash))));
    byHash.forEach((r) => knownHashes.add(r.h));
  }
  const classification = { visit: 0, not_visit: 0, unknown: 0 };
  const rows = unique.map((e) => {
    const c = classifyEvent(e);
    classification[c.classification]++;
    const status: CalendarPreview["sample"][number]["status"] = known.has(e.sourceKey)
      ? "déjà importé"
      : knownHashes.has(e.contentHash)
        ? "doublon probable"
        : "nouveau";
    return { e, c, status };
  });
  const days = unique.map((e) => dayKeyOf(e.start, user.timezone)).sort();
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone: user.timezone, dateStyle: "medium", timeStyle: "short" });
  return {
    format: parsed.format,
    encoding: parsed.encoding,
    sourceEntries: parsed.sourceEntries,
    totalEvents: unique.length,
    alreadyImported: rows.filter((r) => r.status === "déjà importé").length,
    probableDuplicates: rows.filter((r) => r.status === "doublon probable").length,
    duplicatesInFile: parsed.events.length - unique.length,
    cancelled: unique.filter((e) => e.isCancelled).length,
    allDay: unique.filter((e) => e.allDay).length,
    classification,
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
    futureEvents: unique.filter((e) => e.start > now).length,
    warnings: parsed.warnings,
    sample: rows
      .filter((r) => r.status === "nouveau")
      .slice(-15)
      .map(({ e, c, status }) => ({
        when: fmt.format(e.start),
        title: e.title,
        location: e.location,
        classification: c.classification,
        reason: c.reason,
        status,
      })),
  };
}

/**
 * Importe un fichier de calendrier. L'opération est rejouable :
 * - un événement déjà importé (même clé) n'est jamais recréé ;
 * - un événement modifié dans Outlook est mis à jour, et son rendez-vous aussi
 *   tant qu'il n'a pas été modifié dans Léa ;
 * - les décisions de rapprochement déjà prises (validées / ignorées) sont conservées.
 */
export async function importCalendarFile(
  db: Db,
  user: ImportUser,
  file: { name: string; bytes: Uint8Array },
  options: { useDescription?: boolean; now?: Date } = {},
): Promise<CalendarImportSummary> {
  const now = options.now ?? new Date();
  const parsed = parseCalendarFile(file.bytes, user.timezone, now);

  // Doublons internes au fichier (même clé) : on garde la première occurrence
  const unique: ParsedCalendarEvent[] = [];
  const seen = new Set<string>();
  for (const e of parsed.events) {
    if (seen.has(e.sourceKey)) continue;
    seen.add(e.sourceKey);
    unique.push(e);
  }
  const duplicatesInFile = parsed.events.length - unique.length;

  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(calendarImports)
      .values({
        userId: user.id,
        filename: file.name.slice(0, 200),
        format: parsed.format,
        fileSha256: sha256(file.bytes),
        status: "completed",
      })
      .returning({ id: calendarImports.id });
    const importId = imp!.id;

    // Événements déjà connus : par clé, et par empreinte (même événement sous un autre format)
    const existingByKey = new Map<string, CalendarEvent>();
    const existingByHash = new Map<string, string>();
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000);
      const rows = await tx
        .select()
        .from(calendarEvents)
        .where(and(eq(calendarEvents.userId, user.id), inArray(calendarEvents.sourceKey, chunk.map((e) => e.sourceKey))));
      for (const r of rows) existingByKey.set(r.sourceKey, r);
      const byHash = await tx
        .select({ id: calendarEvents.id, contentHash: calendarEvents.contentHash, sourceKey: calendarEvents.sourceKey })
        .from(calendarEvents)
        .where(and(eq(calendarEvents.userId, user.id), inArray(calendarEvents.contentHash, chunk.map((e) => e.contentHash))));
      for (const r of byHash) if (!existingByHash.has(r.contentHash)) existingByHash.set(r.contentHash, r.id);
    }

    const toInsert: (typeof calendarEvents.$inferInsert)[] = [];
    const changed: { before: CalendarEvent; after: ParsedCalendarEvent }[] = [];
    const unchangedIds: string[] = [];
    const classification = { visit: 0, not_visit: 0, unknown: 0 };
    let probableDuplicates = 0;

    for (const e of unique) {
      const cls = classifyEvent(e);
      classification[cls.classification]++;
      const existing = existingByKey.get(e.sourceKey);
      const fields = {
        uid: e.uid,
        recurrenceId: e.recurrenceId,
        title: e.title,
        description: e.description,
        location: e.location,
        startsAt: e.start,
        endsAt: e.end,
        allDay: e.allDay,
        sourceTimezone: e.sourceTimezone,
        isCancelled: e.isCancelled,
        isRecurring: e.isRecurring,
        contentHash: e.contentHash,
        classification: cls.classification,
        classificationReason: cls.reason,
        raw: e.raw,
      };
      if (existing) {
        const same =
          existing.contentHash === e.contentHash &&
          existing.isCancelled === e.isCancelled &&
          (existing.location ?? null) === e.location &&
          (existing.description ?? null) === e.description;
        if (same) unchangedIds.push(existing.id);
        else changed.push({ before: existing, after: e });
        if (!same) {
          await tx
            .update(calendarEvents)
            .set({ ...fields, lastSeenImportId: importId })
            .where(eq(calendarEvents.id, existing.id));
        }
        continue;
      }
      const duplicateOf = existingByHash.get(e.contentHash) ?? null;
      if (duplicateOf) probableDuplicates++;
      toInsert.push({
        ...fields,
        userId: user.id,
        importId,
        lastSeenImportId: importId,
        sourceKey: e.sourceKey,
        duplicateOfId: duplicateOf,
      });
    }

    if (unchangedIds.length) {
      for (let i = 0; i < unchangedIds.length; i += 1000) {
        await tx
          .update(calendarEvents)
          .set({ lastSeenImportId: importId })
          .where(inArray(calendarEvents.id, unchangedIds.slice(i, i + 1000)));
      }
    }

    const inserted: CalendarEvent[] = [];
    for (let i = 0; i < toInsert.length; i += 500) {
      const rows = await tx.insert(calendarEvents).values(toInsert.slice(i, i + 500)).returning();
      inserted.push(...rows);
      // Les doublons au sein d'un même import sont rattachés au premier événement inséré
      for (const r of rows) if (!existingByHash.has(r.contentHash)) existingByHash.set(r.contentHash, r.id);
    }

    // Rapprochement des nouveaux événements
    const index = buildMatchIndex(await listForMatching(tx, user.id));
    const toMatch = inserted.filter((e) => !e.duplicateOfId && !e.isCancelled && e.classification !== "not_visit");
    const batch = await matchEvents(tx, user, toMatch, index, options.useDescription ?? false);
    const matchCounts = batch.counts;
    let appointmentsCreated = batch.appointmentsCreated;

    // Événements modifiés dans Outlook : synchronisation prudente, puis nouveau rapprochement
    // s'il n'y avait pas encore de décision de l'utilisatrice
    let appointmentsUpdated = 0;
    for (const { before, after } of changed) {
      appointmentsUpdated += await syncChangedEvent(tx, user, before, after);
    }
    if (changed.length) {
      const ids = changed.map((c) => c.before.id);
      const refreshed = await tx.select().from(calendarEvents).where(inArray(calendarEvents.id, ids));
      const decided = await tx
        .select({ eventId: appointmentMatches.calendarEventId, status: appointmentMatches.status })
        .from(appointmentMatches)
        .where(inArray(appointmentMatches.calendarEventId, ids));
      const statusByEvent = new Map(decided.map((d) => [d.eventId, d.status]));
      const reopen = refreshed.filter((e) => {
        const status = statusByEvent.get(e.id);
        const open = status === undefined || status === "pending" || status === "no_candidate";
        return open && !e.duplicateOfId && !e.isCancelled && e.classification !== "not_visit";
      });
      appointmentsCreated += (await matchEvents(tx, user, reopen, index, options.useDescription ?? false)).appointmentsCreated;
    }

    const days = unique.map((e) => dayKeyOf(e.start, user.timezone)).sort();
    const times = unique.map((e) => e.start.getTime());
    const phone = unique.length
      ? await detectPhoneAppointments(tx, user, { from: new Date(Math.min(...times) - 86_400_000), to: new Date(Math.max(...times) + 86_400_000) })
      : { pending: 0 };
    const summary: CalendarImportSummary = {
      importId,
      format: parsed.format,
      encoding: parsed.encoding,
      sourceEntries: parsed.sourceEntries,
      totalEvents: unique.length,
      newEvents: inserted.length,
      updatedEvents: changed.length,
      unchangedEvents: unchangedIds.length,
      duplicatesInFile,
      probableDuplicates,
      cancelled: unique.filter((e) => e.isCancelled).length,
      classification,
      matches: matchCounts,
      appointmentsCreated,
      appointmentsUpdated,
      phoneToReview: phone.pending,
      warnings: parsed.warnings,
      firstDay: days[0] ?? null,
      lastDay: days.at(-1) ?? null,
    };
    await tx
      .update(calendarImports)
      .set({
        totalEvents: unique.length,
        newEvents: inserted.length,
        updatedEvents: changed.length,
        unchangedEvents: unchangedIds.length,
        warnings: parsed.warnings.slice(0, 200),
      })
      .where(eq(calendarImports.id, importId));
    await logAudit(tx, {
      userId: user.id,
      entity: "calendar_import",
      entityId: importId,
      action: "import",
      after: { filename: file.name, ...summary, warnings: parsed.warnings.length },
    });
    return summary;
  });
}

/**
 * Rapproche une série d'événements en deux passes :
 * 1. score de chaque événement contre le référentiel ;
 * 2. pour les cas incertains, départage par le contexte de la journée (secteur et
 *    lieux des rendez-vous déjà rattachés ce jour-là).
 * Enregistre les propositions et crée les rendez-vous des correspondances sûres.
 */
export async function matchEvents(
  tx: DbOrTx,
  user: ImportUser,
  events: CalendarEvent[],
  index: MatchIndex,
  useDescription: boolean,
) {
  const counts = { auto_validated: 0, pending: 0, no_candidate: 0 };
  let appointmentsCreated = 0;
  if (events.length === 0) return { counts, appointmentsCreated };

  const results = events.map((event) => {
    const candidates = scoreCandidates(event, index, { useDescription });
    return { event, day: dayKeyOf(event.startsAt, user.timezone), candidates, decision: decideMatch(candidates, user.autoMatchThreshold) };
  });

  // Contexte des journées concernées : rendez-vous existants + correspondances sûres de cette passe
  const geoRows = await tx
    .select({ id: pharmacies.id, departmentCode: pharmacies.departmentCode, lat: pharmacies.lat, lng: pharmacies.lng })
    .from(pharmacies)
    .where(eq(pharmacies.userId, user.id));
  const geo = new Map<string, PharmacyGeo>(
    geoRows.map((p) => [p.id, { departmentCode: p.departmentCode, location: p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null }]),
  );
  const contexts = new Map<string, DayContext>();
  const addToContext = (day: string, pharmacyId: string | null) => {
    const g = pharmacyId ? geo.get(pharmacyId) : undefined;
    if (!g) return;
    const ctx = contexts.get(day) ?? { departments: new Map<string, number>(), points: [] };
    if (g.departmentCode) ctx.departments.set(g.departmentCode, (ctx.departments.get(g.departmentCode) ?? 0) + 1);
    if (g.location) ctx.points.push(g.location);
    contexts.set(day, ctx);
  };
  const times = events.map((e) => e.startsAt.getTime());
  const existing = await tx
    .select({ startsAt: appointments.startsAt, pharmacyId: appointments.pharmacyId })
    .from(appointments)
    .where(
      and(
        eq(appointments.userId, user.id),
        eq(appointments.kind, "visit"),
        ne(appointments.status, "cancelled"),
        gte(appointments.startsAt, new Date(Math.min(...times) - 86_400_000)),
        lte(appointments.startsAt, new Date(Math.max(...times) + 86_400_000)),
      ),
    );
  for (const a of existing) addToContext(dayKeyOf(a.startsAt, user.timezone), a.pharmacyId);
  for (const r of results) if (r.decision.status === "auto_validated") addToContext(r.day, r.decision.best!.pharmacyId);

  const names = await territoryNames(tx, user.id);
  const deptName = (code: string) => names.get(code) ?? code;
  for (const r of results) {
    if (r.decision.status !== "pending") continue;
    const adjusted = applyDayContext(r.candidates, contexts.get(r.day), geo, deptName);
    r.candidates = adjusted;
    r.decision = decideMatch(adjusted, user.autoMatchThreshold);
  }
  // Journées encore sans ancrage : consensus entre les rendez-vous ambigus du même jour
  const pendingByDay = new Map<string, typeof results>();
  for (const r of results) {
    if (r.decision.status !== "pending" || contexts.has(r.day)) continue;
    pendingByDay.set(r.day, [...(pendingByDay.get(r.day) ?? []), r]);
  }
  for (const group of pendingByDay.values()) {
    const adjusted = applyDayConsensus(group.map((r) => r.candidates), geo, deptName);
    group.forEach((r, i) => {
      r.candidates = adjusted[i]!;
      r.decision = decideMatch(r.candidates, user.autoMatchThreshold);
    });
  }

  for (const { event, candidates, decision } of results) {
    counts[decision.status]++;
    const values = {
      pharmacyId: decision.best?.pharmacyId ?? null,
      score: decision.best?.score ?? 0,
      status: decision.status,
      reasons: decision.best?.reasons ?? [],
      candidates,
      decidedAt: decision.status === "auto_validated" ? new Date() : null,
    };
    await tx
      .insert(appointmentMatches)
      .values({ userId: user.id, calendarEventId: event.id, ...values })
      .onConflictDoUpdate({ target: appointmentMatches.calendarEventId, set: values });
    if (decision.status === "auto_validated" && decision.best) {
      if (await ensureAppointmentForEvent(tx, user, event, decision.best.pharmacyId, "Rapprochement automatique")) appointmentsCreated++;
    }
  }
  return { counts, appointmentsCreated };
}

async function territoryNames(tx: DbOrTx, userId: string) {
  const rows = await tx.select({ code: territories.code, name: territories.name }).from(territories).where(eq(territories.userId, userId));
  return new Map(rows.map((r) => [r.code, r.name]));
}

/** Crée (ou rattache) le rendez-vous issu d'un événement importé. Idempotent. */
export async function ensureAppointmentForEvent(
  tx: DbOrTx,
  user: ImportUser,
  event: CalendarEvent,
  pharmacyId: string,
  reason: string,
): Promise<boolean> {
  const [existing] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.userId, user.id), eq(appointments.calendarEventId, event.id)));
  if (existing) {
    if (existing.pharmacyId !== pharmacyId) {
      await tx.update(appointments).set({ pharmacyId }).where(eq(appointments.id, existing.id));
      await logAudit(tx, {
        userId: user.id,
        entity: "appointment",
        entityId: existing.id,
        action: "update",
        before: { pharmacyId: existing.pharmacyId },
        after: { pharmacyId },
        reason,
      });
    }
    return false;
  }
  if (event.isCancelled) return false;
  let endsAt = event.endsAt;
  let notes: string | null = null;
  if (endsAt <= event.startsAt) {
    endsAt = new Date(event.startsAt.getTime() + user.defaultVisitMinutes * 60_000);
    notes = `Durée absente de l'agenda : durée par défaut appliquée (${user.defaultVisitMinutes} min).`;
  }
  const [created] = await tx
    .insert(appointments)
    .values({
      userId: user.id,
      pharmacyId,
      kind: "visit",
      title: event.title,
      startsAt: event.startsAt,
      endsAt,
      // Un rendez-vous présent dans l'agenda est considéré comme convenu ; sa réalisation reste à confirmer.
      status: "confirmed",
      outcome: "unknown",
      source: "calendar_import",
      calendarEventId: event.id,
      notes,
    })
    .returning();
  await logAudit(tx, { userId: user.id, entity: "appointment", entityId: created!.id, action: "create", after: created, reason });
  return true;
}

/**
 * Un événement a changé dans Outlook. Le rendez-vous associé est mis à jour
 * seulement s'il n'a pas été modifié dans Léa (mêmes horaires qu'avant).
 */
async function syncChangedEvent(tx: DbOrTx, user: ImportUser, before: CalendarEvent, after: ParsedCalendarEvent): Promise<number> {
  const [appt] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.userId, user.id), eq(appointments.calendarEventId, before.id)));
  if (!appt) return 0;
  const untouched =
    appt.startsAt.getTime() === before.startsAt.getTime() && appt.status !== "cancelled" && appt.outcome === "unknown";
  if (!untouched) return 0;
  const patch: Partial<typeof appointments.$inferInsert> = {};
  if (after.isCancelled) patch.status = "cancelled";
  else if (after.start.getTime() !== appt.startsAt.getTime() || after.end.getTime() !== appt.endsAt.getTime()) {
    if (after.end > after.start) {
      patch.startsAt = after.start;
      patch.endsAt = after.end;
    }
  }
  if (after.title !== appt.title) patch.title = after.title;
  if (Object.keys(patch).length === 0) return 0;
  await tx.update(appointments).set(patch).where(eq(appointments.id, appt.id));
  await logAudit(tx, {
    userId: user.id,
    entity: "appointment",
    entityId: appt.id,
    action: "update",
    before: { startsAt: appt.startsAt, endsAt: appt.endsAt, status: appt.status, title: appt.title },
    after: patch,
    reason: "Événement modifié dans Outlook (réimport)",
  });
  return 1;
}
