import "server-only";
import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { appointments, pharmacies, pharmacyMetrics, visitReports, type Appointment } from "../db/schema";
import { logAudit } from "../repositories/audit";

export class AppointmentError extends Error {}

export type AppointmentInput = {
  pharmacyId: string | null;
  kind: "visit" | "unavailable" | "other";
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: "proposed" | "pending" | "confirmed" | "cancelled";
  notes: string | null;
};

export type AppointmentWithPharmacy = {
  appointment: Appointment;
  pharmacy: {
    id: string;
    name: string;
    city: string | null;
    postalCode: string | null;
    addressLine: string | null;
    departmentCode: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  category: "A" | "B" | "C" | "D" | null;
};

export async function listAppointmentsInRange(db: DbOrTx, userId: string, from: Date, to: Date, options: { includeCancelled?: boolean } = {}) {
  const rows = await db
    .select({
      appointment: appointments,
      pharmacy: {
        id: pharmacies.id,
        name: pharmacies.name,
        city: pharmacies.city,
        postalCode: pharmacies.postalCode,
        addressLine: pharmacies.addressLine,
        departmentCode: pharmacies.departmentCode,
        lat: pharmacies.lat,
        lng: pharmacies.lng,
      },
      category: pharmacyMetrics.category,
    })
    .from(appointments)
    .leftJoin(pharmacies, eq(pharmacies.id, appointments.pharmacyId))
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, appointments.pharmacyId))
    .where(
      and(
        eq(appointments.userId, userId),
        lt(appointments.startsAt, to),
        gt(appointments.endsAt, from),
        options.includeCancelled ? undefined : ne(appointments.status, "cancelled"),
      ),
    )
    .orderBy(asc(appointments.startsAt));
  return rows as AppointmentWithPharmacy[];
}

export async function getAppointment(db: DbOrTx, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Rendez-vous non annulés qui chevauchent l'intervalle (hors `excludeId`). */
export async function findOverlaps(db: DbOrTx, userId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
  return db
    .select({ id: appointments.id, title: appointments.title, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.userId, userId),
        ne(appointments.status, "cancelled"),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
        excludeId ? ne(appointments.id, excludeId) : undefined,
      ),
    );
}

async function assertPharmacy(db: DbOrTx, userId: string, pharmacyId: string | null) {
  if (!pharmacyId) return;
  const [p] = await db
    .select({ id: pharmacies.id })
    .from(pharmacies)
    .where(and(eq(pharmacies.id, pharmacyId), eq(pharmacies.userId, userId)));
  if (!p) throw new AppointmentError("Pharmacie introuvable.");
}

function validate(input: AppointmentInput) {
  if (input.endsAt <= input.startsAt) throw new AppointmentError("L'heure de fin doit suivre l'heure de début.");
  if (input.endsAt.getTime() - input.startsAt.getTime() > 14 * 3600_000) throw new AppointmentError("Durée supérieure à 14 h : vérifiez les horaires.");
  if (input.kind === "visit" && !input.pharmacyId) throw new AppointmentError("Choisissez la pharmacie visitée.");
}

export async function createAppointment(
  db: Db,
  userId: string,
  input: AppointmentInput,
  source: Appointment["source"] = "manual",
  reason?: string,
) {
  validate(input);
  return db.transaction(async (tx) => {
    await assertPharmacy(tx, userId, input.pharmacyId);
    const [created] = await tx.insert(appointments).values({ ...input, userId, source }).returning();
    await logAudit(tx, { userId, entity: "appointment", entityId: created!.id, action: "create", after: created, reason });
    return created!;
  });
}

export async function updateAppointment(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<AppointmentInput>,
  options: { reason?: string; allowConfirmedTimeChange?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    const current = await getAppointment(tx, userId, id);
    if (!current) throw new AppointmentError("Rendez-vous introuvable.");
    const next = { ...current, ...patch } as AppointmentInput;
    validate(next);
    const timeChanged =
      (patch.startsAt && patch.startsAt.getTime() !== current.startsAt.getTime()) ||
      (patch.endsAt && patch.endsAt.getTime() !== current.endsAt.getTime());
    // Garde-fou : un rendez-vous confirmé ne change d'horaire qu'avec un accord explicite
    if (timeChanged && current.status === "confirmed" && !options.allowConfirmedTimeChange) {
      throw new AppointmentError("Ce rendez-vous est confirmé : confirmez explicitement le changement d'horaire.");
    }
    if (patch.pharmacyId !== undefined) await assertPharmacy(tx, userId, patch.pharmacyId);
    const [updated] = await tx
      .update(appointments)
      .set(patch)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();
    const changedKeys = Object.keys(patch).filter(
      (k) => JSON.stringify((current as Record<string, unknown>)[k]) !== JSON.stringify((patch as Record<string, unknown>)[k]),
    );
    if (changedKeys.length) {
      await logAudit(tx, {
        userId,
        entity: "appointment",
        entityId: id,
        action: timeChanged ? "move" : "update",
        before: Object.fromEntries(changedKeys.map((k) => [k, (current as Record<string, unknown>)[k]])),
        after: Object.fromEntries(changedKeys.map((k) => [k, (patch as Record<string, unknown>)[k]])),
        reason: options.reason,
      });
    }
    return updated!;
  });
}

/** « Rendez-vous terminé » : la visite est marquée comme réalisée, avec un compte rendu facultatif. */
export async function completeVisit(
  db: Db,
  userId: string,
  id: string,
  report: { summary: string | null; nextActions: string | null },
) {
  return db.transaction(async (tx) => {
    const current = await getAppointment(tx, userId, id);
    if (!current) throw new AppointmentError("Rendez-vous introuvable.");
    if (current.kind !== "visit" || !current.pharmacyId) throw new AppointmentError("Seule une visite en pharmacie peut être terminée.");
    if (current.status === "cancelled") throw new AppointmentError("Ce rendez-vous est annulé.");
    const completedAt = new Date();
    await tx
      .update(appointments)
      .set({ outcome: "done", completedAt, status: current.status === "proposed" ? "confirmed" : current.status })
      .where(eq(appointments.id, id));
    if (report.summary?.trim()) {
      await tx.insert(visitReports).values({
        userId,
        appointmentId: id,
        pharmacyId: current.pharmacyId,
        summary: report.summary.trim(),
        nextActions: report.nextActions?.trim() || null,
      });
    }
    await logAudit(tx, {
      userId,
      entity: "appointment",
      entityId: id,
      action: "complete",
      before: { outcome: current.outcome },
      after: { outcome: "done", completedAt },
    });
    return { pharmacyId: current.pharmacyId };
  });
}

export async function setOutcome(db: Db, userId: string, id: string, outcome: "unknown" | "done" | "missed") {
  return db.transaction(async (tx) => {
    const current = await getAppointment(tx, userId, id);
    if (!current) throw new AppointmentError("Rendez-vous introuvable.");
    await tx
      .update(appointments)
      .set({ outcome, completedAt: outcome === "done" ? (current.completedAt ?? new Date()) : null })
      .where(eq(appointments.id, id));
    await logAudit(tx, { userId, entity: "appointment", entityId: id, action: "outcome", before: { outcome: current.outcome }, after: { outcome } });
  });
}

export async function deleteAppointment(db: Db, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const current = await getAppointment(tx, userId, id);
    if (!current) throw new AppointmentError("Rendez-vous introuvable.");
    if (current.source === "calendar_import") {
      throw new AppointmentError("Ce rendez-vous provient d'Outlook : annulez-le plutôt que de le supprimer (la provenance est conservée).");
    }
    await tx.delete(appointments).where(eq(appointments.id, id));
    await logAudit(tx, { userId, entity: "appointment", entityId: id, action: "delete", before: current });
  });
}

/** Rendez-vous passés dont la réalisation n'a pas été confirmée (pour le rappel « marquer comme réalisée »). */
export async function countUnconfirmedPastVisits(db: DbOrTx, userId: string, since: Date, until: Date) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.userId, userId),
        eq(appointments.kind, "visit"),
        eq(appointments.outcome, "unknown"),
        ne(appointments.status, "cancelled"),
        gt(appointments.startsAt, since),
        lt(appointments.endsAt, until),
      ),
    );
  return row?.n ?? 0;
}
