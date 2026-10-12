"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isDayKey, zonedDateTime } from "@/domain/time";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import {
  completeVisit,
  createAppointment,
  deleteAppointment,
  findOverlaps,
  getAppointment,
  setOutcome,
  updateAppointment,
} from "../services/appointments";
import { toActionError, type ActionResult } from "./result";

const dayKey = z.string().refine(isDayKey, "Date invalide.");
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide.");

const formSchema = z.object({
  pharmacyId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  kind: z.enum(["visit", "unavailable", "other"]),
  title: z.string().trim().max(200),
  day: dayKey,
  start: hhmm,
  end: hhmm,
  status: z.enum(["proposed", "pending", "confirmed", "cancelled"]),
  notes: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => v || null),
});

function readForm(formData: FormData) {
  return formSchema.safeParse(
    Object.fromEntries(["pharmacyId", "kind", "title", "day", "start", "end", "status", "notes"].map((k) => [k, String(formData.get(k) ?? "")])),
  );
}

function overlapWarning(overlaps: { title: string }[]) {
  return overlaps.length
    ? ` Attention : chevauche ${overlaps.map((o) => `« ${o.title} »`).join(", ")}.`
    : "";
}

export async function saveAppointmentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const d = parsed.data;
  const startsAt = zonedDateTime(d.day, d.start, user.timezone);
  const endsAt = zonedDateTime(d.day, d.end, user.timezone);
  const id = z.uuid().safeParse(formData.get("id"));
  const input = {
    pharmacyId: d.kind === "visit" ? d.pharmacyId : null,
    kind: d.kind,
    title: d.title || (d.kind === "unavailable" ? "Indisponible" : "Rendez-vous"),
    startsAt,
    endsAt,
    status: d.status,
    notes: d.notes,
  };
  let savedId: string;
  try {
    if (id.success) {
      const current = await getAppointment(db, user.id, id.data);
      if (!current) return { ok: false, error: "Rendez-vous introuvable." };
      const confirmChange = formData.get("confirmTimeChange") === "on";
      await updateAppointment(db, user.id, id.data, input, { allowConfirmedTimeChange: confirmChange || current.status !== "confirmed" });
      savedId = id.data;
    } else {
      const created = await createAppointment(db, user.id, input);
      savedId = created.id;
    }
  } catch (err) {
    return toActionError(err);
  }
  const overlaps = await findOverlaps(db, user.id, startsAt, endsAt, savedId);
  revalidatePath("/", "layout");
  redirect(`/planning?date=${d.day}&ok=${encodeURIComponent(`Rendez-vous enregistré.${overlapWarning(overlaps)}`)}`);
}

/** Glisser-déposer dans le planning. */
export async function moveAppointmentAction(input: { id: string; day: string; start: string; confirm: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: z.uuid(), day: dayKey, start: hhmm, confirm: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Déplacement invalide." };
  const current = await getAppointment(db, user.id, parsed.data.id);
  if (!current) return { ok: false, error: "Rendez-vous introuvable." };
  const startsAt = zonedDateTime(parsed.data.day, parsed.data.start, user.timezone);
  const endsAt = new Date(startsAt.getTime() + (current.endsAt.getTime() - current.startsAt.getTime()));
  try {
    await updateAppointment(db, user.id, current.id, { startsAt, endsAt }, { allowConfirmedTimeChange: parsed.data.confirm, reason: "Déplacé dans le planning" });
  } catch (err) {
    return toActionError(err);
  }
  const overlaps = await findOverlaps(db, user.id, startsAt, endsAt, current.id);
  revalidatePath("/", "layout");
  return { ok: true, message: `Rendez-vous déplacé.${overlapWarning(overlaps)}` };
}

export async function completeVisitAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ id: z.uuid(), summary: z.string().trim().max(4000), nextActions: z.string().trim().max(2000) })
    .safeParse({ id: formData.get("id"), summary: String(formData.get("summary") ?? ""), nextActions: String(formData.get("nextActions") ?? "") });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  let pharmacyId: string;
  try {
    ({ pharmacyId } = await completeVisit(db, user.id, parsed.data.id, { summary: parsed.data.summary, nextActions: parsed.data.nextActions }));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect(`/pharmacies/${pharmacyId}/prochaine-visite?terminee=1`);
}

export async function setOutcomeAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: z.uuid(), outcome: z.enum(["unknown", "done", "missed"]) }).safeParse({ id: formData.get("id"), outcome: formData.get("outcome") });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  try {
    await setOutcome(db, user.id, parsed.data.id, parsed.data.outcome);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Réalisation mise à jour." };
}

export async function cancelAppointmentAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requête invalide." };
  try {
    await updateAppointment(db, user.id, id.data, { status: "cancelled" }, { reason: "Annulé par l'utilisatrice" });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Rendez-vous annulé." };
}

export async function deleteAppointmentAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requête invalide." };
  try {
    await deleteAppointment(db, user.id, id.data);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect("/planning?ok=Rendez-vous%20supprim%C3%A9.");
}

/** Accepte une proposition de créneau : crée un rendez-vous « proposé » (à confirmer avec le pharmacien). */
export async function proposeSlotAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ pharmacyId: z.uuid(), day: dayKey, start: hhmm, end: hhmm, title: z.string().trim().min(1).max(200) })
    .safeParse(Object.fromEntries(["pharmacyId", "day", "start", "end", "title"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, error: "Proposition invalide." };
  const d = parsed.data;
  try {
    await createAppointment(
      db,
      user.id,
      {
        pharmacyId: d.pharmacyId,
        kind: "visit",
        title: d.title,
        startsAt: zonedDateTime(d.day, d.start, user.timezone),
        endsAt: zonedDateTime(d.day, d.end, user.timezone),
        status: "proposed",
        notes: "Créneau proposé par Léa — à confirmer avec le pharmacien.",
      },
      "suggestion",
      "Proposition de créneau acceptée",
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect(`/planning?date=${d.day}&ok=${encodeURIComponent("Créneau ajouté au planning comme « proposé » : à confirmer avec le pharmacien.")}`);
}
