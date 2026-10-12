import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { buildMatchIndex } from "@/domain/matching";
import type { Db } from "../db/client";
import { appointmentMatches, appointments, calendarEvents, pharmacies } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { listForMatching } from "../repositories/pharmacies";
import { ensureAppointmentForEvent, matchEvents, type ImportUser } from "./calendar-import";

export class ReviewError extends Error {}

/** Valide une correspondance (la pharmacie proposée ou une autre choisie par l'utilisatrice). */
export async function validateMatch(db: Db, user: ImportUser, matchId: string, pharmacyId?: string | null) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ match: appointmentMatches, event: calendarEvents })
      .from(appointmentMatches)
      .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
      .where(and(eq(appointmentMatches.id, matchId), eq(appointmentMatches.userId, user.id)));
    if (!row) throw new ReviewError("Rapprochement introuvable.");
    const chosen = pharmacyId ?? row.match.pharmacyId;
    if (!chosen) throw new ReviewError("Choisissez une pharmacie.");
    const [owned] = await tx
      .select({ id: pharmacies.id })
      .from(pharmacies)
      .where(and(eq(pharmacies.id, chosen), eq(pharmacies.userId, user.id)));
    if (!owned) throw new ReviewError("Pharmacie introuvable.");
    if (row.event.isCancelled) throw new ReviewError("Cet événement est annulé dans l'agenda : il ne peut pas devenir une visite.");

    const candidate = row.match.candidates.find((c) => c.pharmacyId === chosen);
    await tx
      .update(appointmentMatches)
      .set({
        pharmacyId: chosen,
        status: "validated",
        decidedAt: new Date(),
        score: candidate?.score ?? row.match.score,
        reasons: candidate?.reasons ?? ["Pharmacie choisie manuellement"],
      })
      .where(eq(appointmentMatches.id, matchId));
    await logAudit(tx, {
      userId: user.id,
      entity: "appointment_match",
      entityId: matchId,
      action: "validate",
      before: { pharmacyId: row.match.pharmacyId, status: row.match.status },
      after: { pharmacyId: chosen, status: "validated" },
    });
    await ensureAppointmentForEvent(tx, user, row.event, chosen, "Rapprochement validé");
  });
}

/** Ignore un événement (pas une visite). Le rendez-vous créé automatiquement, s'il existe, est retiré. */
export async function ignoreMatch(db: Db, user: ImportUser, matchId: string) {
  return db.transaction(async (tx) => {
    const [match] = await tx
      .select()
      .from(appointmentMatches)
      .where(and(eq(appointmentMatches.id, matchId), eq(appointmentMatches.userId, user.id)));
    if (!match) throw new ReviewError("Rapprochement introuvable.");
    await tx.update(appointmentMatches).set({ status: "ignored", decidedAt: new Date() }).where(eq(appointmentMatches.id, matchId));
    const linked = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.userId, user.id),
          eq(appointments.calendarEventId, match.calendarEventId),
          eq(appointments.source, "calendar_import"),
        ),
      );
    for (const appt of linked) {
      await tx.delete(appointments).where(eq(appointments.id, appt.id));
      await logAudit(tx, {
        userId: user.id,
        entity: "appointment",
        entityId: appt.id,
        action: "delete",
        before: appt,
        reason: "Événement ignoré lors du rapprochement",
      });
    }
    await logAudit(tx, {
      userId: user.id,
      entity: "appointment_match",
      entityId: matchId,
      action: "ignore",
      before: { status: match.status, pharmacyId: match.pharmacyId },
    });
  });
}

/** Valide en une fois les propositions affichées (action explicite de l'utilisatrice). */
export async function validateMany(db: Db, user: ImportUser, matchIds: string[]) {
  let validated = 0;
  for (const id of matchIds.slice(0, 200)) {
    try {
      await validateMatch(db, user, id);
      validated++;
    } catch (err) {
      if (!(err instanceof ReviewError)) throw err;
    }
  }
  return validated;
}

/**
 * Relance le rapprochement des événements sans décision (après l'ajout de
 * pharmacies au référentiel, par exemple). Les décisions prises sont conservées.
 */
export async function rematchOpenEvents(db: Db, user: ImportUser, options: { useDescription?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const index = buildMatchIndex(await listForMatching(tx, user.id));
    const open = await tx
      .select({ event: calendarEvents })
      .from(appointmentMatches)
      .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
      .where(and(eq(appointmentMatches.userId, user.id), inArray(appointmentMatches.status, ["pending", "no_candidate"])));
    const res = await matchEvents(tx, user, open.map((o) => o.event), index, options.useDescription ?? false);
    const counts = { ...res.counts, appointmentsCreated: res.appointmentsCreated };
    await logAudit(tx, { userId: user.id, entity: "appointment_match", entityId: "*", action: "rematch", after: counts });
    return counts;
  });
}
