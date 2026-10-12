"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isDayKey } from "@/domain/time";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { applyRoutePlan, simulateDayPlan, type Endpoint } from "../services/route-plan";
import { toActionError, type ActionResult } from "./result";

/** Signature d'un scénario : ordre et horaires des visites. */
export async function scheduleSignature(stops: { id: string; start: number }[]): Promise<string> {
  return stops.map((s) => `${s.id}@${Math.round(s.start)}`).join("|");
}

function endpoint(value: FormDataEntryValue | null): Endpoint {
  const v = String(value ?? "home");
  return v === "home" ? { kind: "home" } : { kind: "place", id: v };
}

/**
 * Applique le scénario optimisé affiché. La simulation est recalculée et
 * enregistrée ; si elle diffère de ce que l'utilisatrice a validé, rien n'est appliqué.
 */
export async function applyOptimizedAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ day: z.string().refine(isDayKey), signature: z.string().min(1) })
    .safeParse({ day: formData.get("day"), signature: formData.get("signature") });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  if (formData.get("confirm") !== "on") return { ok: false, error: "Cochez la case de confirmation pour appliquer le scénario." };
  const allowConfirmed = formData.get("allowConfirmed") === "1";
  try {
    const sim = await simulateDayPlan(db, user, parsed.data.day, {
      start: endpoint(formData.get("start")),
      end: endpoint(formData.get("end")),
      persist: true,
      allowConfirmed,
    });
    if (!sim || !sim.optimizedPlanId) return { ok: false, error: "Aucune tournée à appliquer pour cette journée." };
    if ((await scheduleSignature(sim.optimized.stops)) !== parsed.data.signature) {
      return { ok: false, error: "Le planning a changé depuis l'affichage du scénario : vérifiez la nouvelle proposition." };
    }
    if (sim.movedConfirmed.length && formData.get("confirmConfirmed") !== "on") {
      return { ok: false, error: "Ce scénario déplace des rendez-vous confirmés : cochez la seconde confirmation." };
    }
    const { changed } = await applyRoutePlan(db, user, sim.optimizedPlanId, { allowConfirmed });
    revalidatePath("/", "layout");
    return { ok: true, message: changed ? `Scénario appliqué : ${changed} visite(s) déplacée(s).` : "Scénario enregistré : aucun horaire à modifier." };
  } catch (err) {
    return toActionError(err);
  }
}
