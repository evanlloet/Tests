"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEPARTMENTS, INITIAL_TERRITORIES } from "@/domain/departments";
import { isInMetropolitanFrance } from "@/domain/geo";
import { EXTRA_SECTOR_COLORS, townByKey } from "@/domain/towns";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { territories, travelPreferences, users, weeklyPreferenceTemplates } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { setTemplateDay } from "../repositories/territories";
import type { ActionResult } from "./result";

/**
 * Parcours d'accueil : chaque étape enregistre immédiatement ses réponses en base
 * (rien n'est gardé seulement dans le navigateur) et mémorise l'étape atteinte
 * pour pouvoir reprendre plus tard.
 */
async function reachStep(userId: string, step: number) {
  const [u] = await db.select({ step: users.onboardingStep }).from(users).where(eq(users.id, userId));
  if ((u?.step ?? 0) < step) await db.update(users).set({ onboardingStep: step }).where(eq(users.id, userId));
}

export async function saveHomeStep(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const townKey = String(formData.get("town") ?? "");
  const address = String(formData.get("address") ?? "").trim().slice(0, 300) || null;
  const town = townByKey(townKey);
  let lat: number | null = null;
  let lng: number | null = null;
  let label = "Domicile";
  if (town) {
    ({ lat, lng } = town);
    label = `Domicile (${town.name})`;
  } else {
    const parse = (v: FormDataEntryValue | null) => {
      const n = Number(String(v ?? "").replace(",", "."));
      return String(v ?? "").trim() === "" || !Number.isFinite(n) ? null : n;
    };
    lat = parse(formData.get("lat"));
    lng = parse(formData.get("lng"));
    if (lat === null || lng === null) return { ok: false, error: "Choisissez votre commune dans la liste, ou saisissez latitude et longitude." };
    if (!isInMetropolitanFrance({ lat, lng })) return { ok: false, error: "Ces coordonnées ne sont pas en France métropolitaine." };
  }
  const values = { homeLabel: label, homeAddress: address ?? (town ? `${town.name} (centre-ville)` : null), homeLat: lat, homeLng: lng };
  await db.insert(travelPreferences).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: travelPreferences.userId, set: values });
  await logAudit(db, { userId: user.id, entity: "travel_preferences", entityId: user.id, action: "onboarding_home", after: values });
  await reachStep(user.id, 2);
  return { ok: true };
}

export async function saveSectorsStep(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const codes = z
    .array(z.string().refine((c) => c in DEPARTMENTS))
    .min(1, "Choisissez au moins un département.")
    .safeParse(formData.getAll("codes").map(String));
  if (!codes.success) return { ok: false, error: codes.error.issues[0]!.message };
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(territories).where(and(eq(territories.userId, user.id), eq(territories.kind, "department")));
    const known = new Set(existing.map((t) => t.code));
    const missing = codes.data.filter((c) => !known.has(c));
    if (missing.length) {
      await tx.insert(territories).values(
        missing.map((code, i) => ({
          userId: user.id,
          kind: "department" as const,
          code,
          name: DEPARTMENTS[code]!,
          color: INITIAL_TERRITORIES.find((t) => t.code === code)?.color ?? EXTRA_SECTOR_COLORS[(existing.length + i) % EXTRA_SECTOR_COLORS.length]!,
        })),
      );
    }
    await tx.update(territories).set({ isActive: false }).where(and(eq(territories.userId, user.id), eq(territories.kind, "department")));
    await tx
      .update(territories)
      .set({ isActive: true })
      .where(and(eq(territories.userId, user.id), eq(territories.kind, "department"), inArray(territories.code, codes.data)));
  });
  await logAudit(db, { userId: user.id, entity: "territories", entityId: user.id, action: "onboarding_sectors", after: codes.data });
  await reachStep(user.id, 3);
  revalidatePath("/bienvenue");
  return { ok: true };
}

export async function saveWeekStep(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const [template] = await db
    .select()
    .from(weeklyPreferenceTemplates)
    .where(and(eq(weeklyPreferenceTemplates.userId, user.id), eq(weeklyPreferenceTemplates.isDefault, true)));
  if (!template) return { ok: false, error: "Modèle de semaine introuvable." };
  const owned = await db.select().from(territories).where(eq(territories.userId, user.id));
  const idByCode = new Map(owned.map((t) => [t.code, t.id]));
  const week: Record<number, string[]> = {};
  await db.transaction(async (tx) => {
    for (const weekday of [1, 2, 3, 4, 5]) {
      const codes = formData.getAll(`day${weekday}`).map(String).filter((c) => idByCode.has(c));
      week[weekday] = codes;
      await setTemplateDay(tx, user.id, template.id, weekday, codes.map((c) => idByCode.get(c)!));
    }
  });
  await logAudit(db, { userId: user.id, entity: "weekly_preferences", entityId: template.id, action: "onboarding_week", after: week });
  await reachStep(user.id, 4);
  return { ok: true };
}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export async function saveRhythmStep(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      workDayStart: hhmm,
      workDayEnd: hhmm,
      lunchStart: hhmm,
      lunchMinutes: z.coerce.number().int().min(0).max(180),
      defaultVisitMinutes: z.coerce.number().int().min(5).max(480),
      bufferMinutes: z.coerce.number().int().min(0).max(120),
    })
    .refine((v) => v.workDayStart < v.workDayEnd, "Le début de journée doit précéder la fin.")
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  await reachStep(user.id, 5);
  return { ok: true };
}

export async function saveFrequenciesStep(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const n = z.coerce.number().int().min(1).max(52);
  const parsed = z
    .object({ frequencyA: n, frequencyB: n, frequencyC: n, frequencyD: n })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Chaque fréquence doit être comprise entre 1 et 52 visites par an." };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  await reachStep(user.id, 6);
  return { ok: true };
}

export async function saveRewardsStep(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await db.update(users).set({ gamificationEnabled: formData.get("enabled") === "on" }).where(eq(users.id, user.id));
  await reachStep(user.id, 7);
  return { ok: true };
}

export async function tourSeenStep(): Promise<ActionResult> {
  const user = await requireUser();
  await reachStep(user.id, 8);
  return { ok: true };
}

const NEXT_PAGES = { pharmacies: "/pharmacies/import", agenda: "/imports", accueil: "/" } as const;

export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const next = String(formData.get("next") ?? "accueil") as keyof typeof NEXT_PAGES;
  await db.update(users).set({ onboardingCompletedAt: new Date(), onboardingStep: 99 }).where(eq(users.id, user.id));
  await logAudit(db, { userId: user.id, entity: "user", entityId: user.id, action: "onboarding_completed" });
  revalidatePath("/", "layout");
  redirect(NEXT_PAGES[next] ?? "/");
}

/** Rejouer le parcours depuis le profil. */
export async function restartOnboardingAction(): Promise<void> {
  const user = await requireUser();
  await db.update(users).set({ onboardingCompletedAt: null, onboardingStep: 0 }).where(eq(users.id, user.id));
  redirect("/bienvenue");
}
