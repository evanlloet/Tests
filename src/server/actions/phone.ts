"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { setAppointmentsMode } from "../services/phone-review";
import { toActionError, type ActionResult } from "./result";

const schema = z.object({ ids: z.array(z.uuid()).min(1).max(2000), mode: z.enum(["onsite", "phone"]) });

/** Valide un ou plusieurs rendez-vous comme téléphoniques ou sur place. */
export async function setPhoneModeAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = schema.safeParse({ ids: formData.getAll("id"), mode: formData.get("mode") });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  try {
    const n = await setAppointmentsMode(db, user, parsed.data.ids, parsed.data.mode);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        parsed.data.mode === "phone"
          ? `${n} rendez-vous confirmé(s) par téléphone : ils sortent des trajets et des tournées.`
          : `${n} rendez-vous confirmé(s) sur place.`,
    };
  } catch (err) {
    return toActionError(err);
  }
}
