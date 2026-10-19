"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/domain/assistant/learning";
import { isDayKey } from "@/domain/time";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { acceptProposedDay, recordFeedback, resetFeedback } from "../services/assistant";
import { toActionError, type ActionResult } from "./result";

const dayKey = z.string().refine(isDayKey);
const reasons = Object.keys(FEEDBACK_REASON_LABELS) as [FeedbackReason, ...FeedbackReason[]];

/** « Ajouter au planning » : les visites proposées deviennent des rendez-vous « proposés ». */
export async function acceptDayAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      day: dayKey,
      departmentCode: z.string().max(3).optional(),
      visits: z.array(z.object({ pharmacyId: z.uuid(), start: z.number().int(), end: z.number().int() })).min(1).max(15),
    })
    .safeParse({
      day: formData.get("day"),
      departmentCode: formData.get("departmentCode") || undefined,
      visits: formData.getAll("visit").map((v) => {
        const [pharmacyId, start, end] = String(v).split("|");
        return { pharmacyId, start: Number(start), end: Number(end) };
      }),
    });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  try {
    const n = await acceptProposedDay(db, user, { day: parsed.data.day, departmentCode: parsed.data.departmentCode ?? null, visits: parsed.data.visits });
    revalidatePath("/", "layout");
    return { ok: true, message: `${n} visite(s) ajoutée(s) au planning, au statut « proposé » : à confirmer avec les pharmacies.` };
  } catch (err) {
    return toActionError(err);
  }
}

/** Refus d'une proposition (journée ou cliente), avec la raison : l'assistant en tient compte. */
export async function feedbackAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      kind: z.enum(["day", "client_day", "client_snooze"]),
      day: dayKey.optional(),
      departmentCode: z.string().max(3).optional(),
      pharmacyId: z.uuid().optional(),
      reason: z.enum(reasons),
    })
    .safeParse({
      kind: formData.get("kind"),
      day: formData.get("day") || undefined,
      departmentCode: formData.get("departmentCode") || undefined,
      pharmacyId: formData.get("pharmacyId") || undefined,
      reason: formData.get("reason"),
    });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  try {
    await recordFeedback(db, user, {
      kind: parsed.data.kind,
      day: parsed.data.day ?? null,
      departmentCode: parsed.data.departmentCode ?? null,
      pharmacyId: parsed.data.pharmacyId ?? null,
      reason: parsed.data.reason,
    });
    revalidatePath("/assistant");
    return { ok: true, message: "C'est noté : j'ai ajusté mes propositions." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetLearningAction(): Promise<ActionResult> {
  const user = await requireUser();
  await resetFeedback(db, user);
  revalidatePath("/assistant");
  return { ok: true, message: "Retours effacés : je repars de vos habitudes d'agenda." };
}
