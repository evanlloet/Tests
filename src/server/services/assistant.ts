import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { buildDays } from "@/domain/analytics/agenda-stats";
import { learnFromFeedback, learnHabits, type AssistantFeedback, type FeedbackReason } from "@/domain/assistant/learning";
import { buildPlan, weekdayName, type ExistingAppointment, type PlannerClient } from "@/domain/assistant/planner";
import { departmentName } from "@/domain/departments";
import { isCategory, targetVisitsPerYear } from "@/domain/frequency";
import { hasLocation } from "@/domain/geo";
import { publicHolidayName } from "@/domain/holidays";
import { normalizeText } from "@/domain/text";
import { addDays, dayKeyOf, isoWeekday, minutesOfDay, zonedDateTime, type DayKey } from "@/domain/time";
import type { SessionUser } from "../auth/session";
import type { Db, DbOrTx } from "../db/client";
import { appointments, assistantFeedback, calendarEvents, pharmacies, pharmacyMetrics, travelPreferences } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { listWeekTemplates } from "../repositories/territories";
import { AppointmentError, listAppointmentsInRange } from "./appointments";
import { loadAgendaData } from "./agenda-data";
import { frequencySettings, todayFor } from "./context";

/** Événements de l'agenda qui retirent une journée du terrain. */
const BLOCKING = /\b(conges?|vacances|rtt|ferie|absence|absent|maladie|seminaire|formation|convention|reunion regionale|salon)\b/;

export async function getAssistantPlan(db: Db, user: SessionUser, months: number, now = new Date()) {
  const today = todayFor(user, now);
  const horizonDays = Math.round(months * 30.5);
  const data = await loadAgendaData(db, user);
  const templates = await listWeekTemplates(db, user.id);
  const template = (templates.find((t) => t.isDefault) ?? templates[0])?.days ?? {};
  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));

  // --- Habitudes : 12 derniers mois
  const yearAgo = addDays(today, -365);
  const past = data.visits.filter((v) => v.day < today && v.day >= yearAgo);
  const history = buildDays({
    visits: past.map((v) => ({ ...v, pendingReview: v.modeReview === "pending", reason: v.modeReason })),
    nights: data.nights,
    teleworkDays: data.telework.map((t) => t.day),
    clients: [],
    home: data.home,
    template,
    targets: frequencySettings(user),
    today,
    tz: user.timezone,
    estimate: data.estimate,
  });
  const habits = learnHabits(
    history,
    data.nights.filter((n) => n.night >= yearAgo && n.night < today),
    template,
    past.filter((v) => v.mode === "onsite").map((v) => (v.end.getTime() - v.start.getTime()) / 60_000),
  );

  // --- Retours sur les propositions
  const feedbackRows = await db.select().from(assistantFeedback).where(eq(assistantFeedback.userId, user.id)).orderBy(desc(assistantFeedback.createdAt)).limit(2000);
  const feedback: AssistantFeedback[] = feedbackRows.map((f) => ({
    kind: f.kind,
    action: f.action,
    day: f.day,
    weekday: f.weekday,
    departmentCode: f.departmentCode,
    pharmacyId: f.pharmacyId,
    reason: f.reason as FeedbackReason,
    until: f.until,
    createdOn: dayKeyOf(f.createdAt, user.timezone),
  }));
  const learning = learnFromFeedback(feedback, today, (c) => departmentName(c), weekdayName);

  // --- Clientes
  const rows = await db
    .select({ p: pharmacies, m: pharmacyMetrics })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(and(eq(pharmacies.userId, user.id), sql`${pharmacies.status} <> 'closed'`));
  const lastOnsite = new Map<string, DayKey>();
  for (const v of data.visits) if (v.day < today && v.mode === "onsite") lastOnsite.set(v.pharmacyId, v.day);
  const settings = frequencySettings(user);
  const clients: PlannerClient[] = rows.map(({ p, m }) => {
    const category = isCategory(m?.category) ? m!.category : null;
    return {
      id: p.id,
      name: p.name,
      city: p.city,
      departmentCode: p.departmentCode,
      category,
      location: hasLocation(p) ? { lat: p.lat, lng: p.lng } : null,
      perYear: targetVisitsPerYear(category, m?.targetVisitsPerYear ?? null, settings).perYear,
      lastOnsite: lastOnsite.get(p.id) ?? null,
      fileNextVisit: m?.plannedVisitOn ?? null,
    };
  });

  // --- Rendez-vous à venir
  const from = zonedDateTime(addDays(today, 1), "00:00", user.timezone);
  const to = zonedDateTime(addDays(today, horizonDays + 1), "00:00", user.timezone);
  const future = await listAppointmentsInRange(db, user.id, from, to);
  const existing: ExistingAppointment[] = future.map(({ appointment: a, pharmacy: p }) => ({
    id: a.id,
    day: dayKeyOf(a.startsAt, user.timezone),
    start: minutesOfDay(a.startsAt, user.timezone),
    end: Math.max(minutesOfDay(a.endsAt, user.timezone), minutesOfDay(a.startsAt, user.timezone) + 15),
    pharmacyId: a.pharmacyId,
    title: p?.name ?? a.title,
    departmentCode: p?.departmentCode ?? null,
    location: p && hasLocation(p) ? { lat: p.lat!, lng: p.lng! } : null,
    kind: a.kind,
    mode: a.mode,
  }));

  // --- Jours sans terrain
  const blockedDays = new Map<DayKey, string>();
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(today, i);
    const h = publicHolidayName(d);
    if (h) blockedDays.set(d, `Férié (${h})`);
  }
  for (const t of data.telework) if (t.day > today) blockedDays.set(t.day, "Télétravail");
  const events = await db
    .select({ title: calendarEvents.title, start: calendarEvents.startsAt, end: calendarEvents.endsAt, allDay: calendarEvents.allDay })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, user.id), eq(calendarEvents.isCancelled, false), gte(calendarEvents.endsAt, from), lt(calendarEvents.startsAt, to)));
  for (const e of events) {
    const title = normalizeText(e.title);
    if (!BLOCKING.test(title)) continue;
    if (!e.allDay && e.end.getTime() - e.start.getTime() < 4 * 3600_000) continue;
    const label = /conge|vacances|rtt/.test(title) ? "Congés" : /ferie/.test(title) ? "Férié" : "Séminaire / formation";
    const last = dayKeyOf(new Date(e.end.getTime() - 1), user.timezone);
    for (let d = dayKeyOf(e.start, user.timezone); d <= last; d = addDays(d, 1)) if (!blockedDays.has(d)) blockedDays.set(d, label);
  }

  const plan = buildPlan({
    today,
    horizonDays,
    clients,
    existing,
    blockedDays,
    habits,
    learning,
    home: data.home,
    hotelThresholdKm: travel?.hotelThresholdKm ?? 150,
    bookedNights: new Map(data.nights.filter((n) => n.night >= today).map((n) => [n.night, { name: n.hotel, city: n.city }])),
    estimate: data.estimate,
  });
  const pendingPhone = data.visits.filter((v) => v.modeReview === "pending").length;
  return { today, months, habits, learning, plan, hasHome: data.home !== null, pendingPhone, clientsCount: clients.length };
}

export type AssistantPlan = Awaited<ReturnType<typeof getAssistantPlan>>;

// ---------------------------------------------------------------------------

/** Ajoute au planning les visites proposées pour une journée (statut « proposé », à confirmer avec les pharmacies). */
export async function acceptProposedDay(
  db: Db,
  user: SessionUser,
  input: { day: DayKey; departmentCode: string | null; visits: { pharmacyId: string; start: number; end: number }[] },
) {
  if (!input.visits.length) throw new AppointmentError("Aucune visite à ajouter.");
  if (input.day <= todayFor(user)) throw new AppointmentError("Cette journée est passée.");
  return db.transaction(async (tx) => {
    const ids = input.visits.map((v) => v.pharmacyId);
    const owned = await tx.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).where(and(eq(pharmacies.userId, user.id), inArray(pharmacies.id, ids)));
    const names = new Map(owned.map((p) => [p.id, p.name]));
    if (names.size !== new Set(ids).size) throw new AppointmentError("Pharmacie introuvable.");
    const dayStart = zonedDateTime(input.day, "00:00", user.timezone);
    const dayEnd = zonedDateTime(addDays(input.day, 1), "00:00", user.timezone);
    const already = await tx
      .select({ pharmacyId: appointments.pharmacyId })
      .from(appointments)
      .where(and(eq(appointments.userId, user.id), gte(appointments.startsAt, dayStart), lt(appointments.startsAt, dayEnd), ne(appointments.status, "cancelled")));
    const skip = new Set(already.map((a) => a.pharmacyId));
    const values = input.visits
      .filter((v) => !skip.has(v.pharmacyId))
      .map((v) => {
        if (v.start < 6 * 60 || v.end > 22 * 60 || v.end <= v.start) throw new AppointmentError("Horaires invalides.");
        const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        return {
          userId: user.id,
          pharmacyId: v.pharmacyId,
          kind: "visit" as const,
          title: names.get(v.pharmacyId)!,
          startsAt: zonedDateTime(input.day, hhmm(v.start), user.timezone),
          endsAt: zonedDateTime(input.day, hhmm(v.end), user.timezone),
          status: "proposed" as const,
          source: "suggestion" as const,
          notes: "Proposé par l'assistant de planification",
        };
      });
    const created = values.length ? await tx.insert(appointments).values(values).returning({ id: appointments.id }) : [];
    await tx.insert(assistantFeedback).values({
      userId: user.id,
      kind: "day",
      action: "accepted",
      day: input.day,
      weekday: isoWeekday(input.day),
      departmentCode: input.departmentCode,
      reason: "accepted",
    });
    await logAudit(
      tx,
      created.map((c) => ({ userId: user.id, entity: "appointment", entityId: c.id, action: "create", reason: "Assistant de planification" })),
    );
    return created.length;
  });
}

export async function recordFeedback(
  db: DbOrTx,
  user: SessionUser,
  input: { kind: "day" | "client_day" | "client_snooze"; day: DayKey | null; departmentCode: string | null; pharmacyId: string | null; reason: FeedbackReason },
) {
  if (input.pharmacyId) {
    const [p] = await db.select({ id: pharmacies.id }).from(pharmacies).where(and(eq(pharmacies.userId, user.id), eq(pharmacies.id, input.pharmacyId)));
    if (!p) throw new AppointmentError("Pharmacie introuvable.");
  }
  const until = input.reason === "too_soon" || input.kind === "client_snooze" ? addDays(input.day ?? todayFor(user), 30) : null;
  await db.insert(assistantFeedback).values({
    userId: user.id,
    kind: input.kind,
    action: "rejected",
    day: input.day,
    weekday: input.day ? isoWeekday(input.day) : null,
    departmentCode: input.departmentCode,
    pharmacyId: input.pharmacyId,
    reason: input.reason,
    until,
  });
}

/** Efface ce que l'assistant a appris des retours (les habitudes tirées de l'agenda restent). */
export async function resetFeedback(db: DbOrTx, user: SessionUser) {
  await db.delete(assistantFeedback).where(eq(assistantFeedback.userId, user.id));
}

export async function feedbackHistory(db: DbOrTx, user: SessionUser, limit = 30) {
  return db
    .select({ f: assistantFeedback, name: pharmacies.name })
    .from(assistantFeedback)
    .leftJoin(pharmacies, eq(pharmacies.id, assistantFeedback.pharmacyId))
    .where(eq(assistantFeedback.userId, user.id))
    .orderBy(desc(assistantFeedback.createdAt), asc(assistantFeedback.id))
    .limit(limit);
}
