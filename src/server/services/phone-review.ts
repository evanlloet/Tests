import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LatLng } from "@/domain/geo";
import { detectPhoneVisits } from "@/domain/scheduling/phone";
import { addDays, type DayKey } from "@/domain/time";
import type { DbOrTx } from "../db/client";
import { appointments } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { loadAgendaData, type AgendaVisit } from "./agenda-data";

type PhoneUser = { id: string; timezone: string };

/**
 * Repère les rendez-vous téléphoniques probables (voir domain/scheduling/phone)
 * et les marque « à valider ». Les choix déjà validés par l'utilisatrice ne sont
 * jamais modifiés ; une détection qui ne tient plus est retirée.
 */
export async function detectPhoneAppointments(db: DbOrTx, user: PhoneUser, range?: { from: Date; to: Date }) {
  const data = await loadAgendaData(db, user, range);
  const byDay = new Map<DayKey, AgendaVisit[]>();
  for (const v of data.visits) byDay.set(v.day, [...(byDay.get(v.day) ?? []), v]);
  const nightAt = new Map(data.nights.map((n) => [n.night, n.location]));

  const flagged = new Map<string, { reason: string }>();
  for (const [day, list] of byDay) {
    // Un rendez-vous validé comme téléphonique ne compte pas dans la géographie de la journée
    const physical = list.filter((v) => !(v.modeReview === "validated" && v.mode === "phone"));
    const result = detectPhoneVisits(
      {
        visits: physical.map((v) => ({ id: v.id, start: v.start, end: v.end, pharmacyKey: v.pharmacyId, place: v.city ?? v.pharmacyName, location: v.location })),
        teleworkBlocks: data.telework.filter((t) => t.day === day),
        dayStart: nightAt.get(addDays(day, -1)) ?? data.home,
        dayEnd: nightAt.get(day) ?? data.home,
      },
      data.estimate,
    );
    for (const [id, d] of result) flagged.set(id, { reason: d.level === "certain" ? d.reason : `Probable : ${d.reason.charAt(0).toLowerCase()}${d.reason.slice(1)}` });
  }

  let added = 0;
  let cleared = 0;
  for (const v of data.visits) {
    if (v.modeReview === "validated") continue;
    const f = flagged.get(v.id);
    if (f && (v.mode !== "phone" || v.modeReason !== f.reason)) {
      await db.update(appointments).set({ mode: "phone", modeReview: "pending", modeReason: f.reason }).where(eq(appointments.id, v.id));
      if (v.mode !== "phone") added++;
    } else if (!f && v.modeReview === "pending") {
      await db.update(appointments).set({ mode: "onsite", modeReview: "none", modeReason: null }).where(eq(appointments.id, v.id));
      cleared++;
    }
  }
  return { added, cleared, pending: await countPendingPhone(db, user.id) };
}

export async function countPendingPhone(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.userId, userId), eq(appointments.modeReview, "pending"), sql`${appointments.status} <> 'cancelled'`));
  return row?.n ?? 0;
}

export type PhoneReviewDay = {
  day: DayKey;
  /** Hôtel du soir précédent ou du soir même, pour situer la journée */
  night: string | null;
  visits: (Pick<AgendaVisit, "id" | "start" | "end" | "pharmacyId" | "pharmacyName" | "city" | "departmentCode" | "mode" | "modeReview" | "modeReason"> & { location: LatLng | null })[];
};

/** Journées comportant au moins un rendez-vous téléphonique à valider, avec tous leurs rendez-vous pour le contexte. */
export async function listPhoneReview(db: DbOrTx, user: PhoneUser, which: "pending" | "validated" = "pending"): Promise<PhoneReviewDay[]> {
  const data = await loadAgendaData(db, user);
  const days = new Set(
    data.visits.filter((v) => (which === "pending" ? v.modeReview === "pending" : v.modeReview === "validated" && v.mode === "phone")).map((v) => v.day),
  );
  const nights = new Map(data.nights.map((n) => [n.night, n]));
  return [...days].sort().reverse().map((day) => {
    const n = nights.get(day) ?? nights.get(addDays(day, -1));
    return {
      day,
      night: n ? `${n.hotel}${n.city ? ` (${n.city})` : ""}` : null,
      visits: data.visits.filter((v) => v.day === day),
    };
  });
}

/** Choix de l'utilisatrice : téléphone ou sur place. Définitif (la détection ne revient plus dessus). */
export async function setAppointmentsMode(db: DbOrTx, user: { id: string }, ids: string[], mode: "onsite" | "phone") {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(appointments)
    .set({ mode, modeReview: "validated" })
    .where(and(eq(appointments.userId, user.id), inArray(appointments.id, ids), eq(appointments.kind, "visit")))
    .returning({ id: appointments.id });
  await logAudit(
    db,
    updated.map((u) => ({ userId: user.id, entity: "appointment", entityId: u.id, action: mode === "phone" ? "mark_phone" : "mark_onsite", after: { mode } })),
  );
  return updated.length;
}
