"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { importCalendarFile, type CalendarImportSummary } from "../services/calendar-import";
import { ignoreMatch, rematchOpenEvents, validateMany, validateMatch } from "../services/match-review";
import { readUpload, toActionError, type ActionResult } from "./result";

export async function importCalendarAction(
  _prev: ActionResult<CalendarImportSummary> | null,
  formData: FormData,
): Promise<ActionResult<CalendarImportSummary>> {
  const user = await requireUser();
  const file = await readUpload(formData.get("file"), [".ics", ".csv", ".txt"]);
  if (typeof file === "string") return { ok: false, error: file };
  try {
    const summary = await importCalendarFile(db, user, file, { useDescription: formData.get("useDescription") === "on" });
    revalidatePath("/", "layout");
    return { ok: true, data: summary };
  } catch (err) {
    return toActionError(err);
  }
}

export async function validateMatchAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ matchId: z.uuid(), pharmacyId: z.union([z.uuid(), z.literal("")]).optional() })
    .safeParse({ matchId: formData.get("matchId"), pharmacyId: formData.get("pharmacyId") ?? undefined });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  try {
    await validateMatch(db, user, parsed.data.matchId, parsed.data.pharmacyId || null);
    revalidatePath("/", "layout");
    return { ok: true, message: "Correspondance validée : la visite est ajoutée à l'historique." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function ignoreMatchAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const matchId = z.uuid().safeParse(formData.get("matchId"));
  if (!matchId.success) return { ok: false, error: "Requête invalide." };
  try {
    await ignoreMatch(db, user, matchId.data);
    revalidatePath("/", "layout");
    return { ok: true, message: "Événement ignoré." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function validateManyAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const ids = z.array(z.uuid()).max(200).safeParse(formData.getAll("matchIds"));
  if (!ids.success || ids.data.length === 0) return { ok: false, error: "Aucune proposition sélectionnée." };
  try {
    const n = await validateMany(db, user, ids.data);
    revalidatePath("/", "layout");
    return { ok: true, message: `${n} correspondance(s) validée(s).` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function rematchAction(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const res = await rematchOpenEvents(db, user);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Rapprochement relancé : ${res.auto_validated} validé(s) automatiquement, ${res.pending} à vérifier, ${res.no_candidate} sans pharmacie trouvée.`,
    };
  } catch (err) {
    return toActionError(err);
  }
}
