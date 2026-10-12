"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isDayKey } from "@/domain/time";
import { isInMetropolitanFrance } from "@/domain/geo";
import { geocodeAddress, geocoderConfigured } from "@/integrations/geocoding/geoplateforme";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { favoritePlaces, territories, travelPreferences, users } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { assignWeekTemplate, setDefaultTemplate, setTemplateDay } from "../repositories/territories";
import { toActionError, type ActionResult } from "./result";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Heure au format HH:MM.");
const int = (min: number, max: number, label: string) =>
  z.coerce.number().int(`${label} : nombre entier attendu.`).min(min, `${label} : minimum ${min}.`).max(max, `${label} : maximum ${max}.`);

export async function updateSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const schema = z
    .object({
      displayName: z.string().trim().min(1).max(80),
      workDayStart: hhmm,
      workDayEnd: hhmm,
      lunchStart: hhmm,
      lunchMinutes: int(0, 180, "Pause déjeuner"),
      defaultVisitMinutes: int(5, 480, "Durée de visite"),
      bufferMinutes: int(0, 120, "Temps tampon"),
      frequencyA: int(1, 52, "Fréquence A"),
      frequencyB: int(1, 52, "Fréquence B"),
      frequencyC: int(1, 52, "Fréquence C"),
      frequencyD: int(1, 52, "Fréquence D"),
      autoMatchThreshold: z.coerce.number().min(0.6, "Seuil minimal : 0,6").max(1),
    })
    .refine((v) => v.workDayStart < v.workDayEnd, "Le début de journée doit précéder la fin.");
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  await logAudit(db, { userId: user.id, entity: "user_settings", entityId: user.id, action: "update", after: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Préférences enregistrées." };
}

export async function updateTravelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const optionalCoord = z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
    .pipe(z.number().finite().nullable());
  const schema = z.object({
    homeLabel: z.string().trim().min(1).max(80),
    homeAddress: z
      .string()
      .trim()
      .max(300)
      .transform((v) => v || null),
    homeLat: optionalCoord,
    homeLng: optionalCoord,
    maxDailyDriveMinutes: int(30, 900, "Conduite maximale"),
    hotelThresholdKm: int(10, 1000, "Seuil d'hôtel"),
    estimateSpeedKmh: int(30, 130, "Vitesse"),
    estimateRoadFactor: z.coerce.number().min(1, "Coefficient minimal : 1").max(2, "Coefficient maximal : 2"),
    mustReturnHomeWeekdays: z.array(z.coerce.number().int().min(1).max(7)),
  });
  const parsed = schema.safeParse({
    ...Object.fromEntries([...formData.entries()].filter(([k]) => k !== "mustReturnHomeWeekdays")),
    mustReturnHomeWeekdays: formData.getAll("mustReturnHomeWeekdays"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const d = parsed.data;
  if ((d.homeLat === null) !== (d.homeLng === null)) return { ok: false, error: "Renseignez latitude et longitude du domicile, ou aucune des deux." };
  if (d.homeLat !== null && !isInMetropolitanFrance({ lat: d.homeLat, lng: d.homeLng! })) {
    return { ok: false, error: "Coordonnées du domicile hors de France métropolitaine." };
  }
  await db
    .insert(travelPreferences)
    .values({ userId: user.id, ...d })
    .onConflictDoUpdate({ target: travelPreferences.userId, set: d });
  await logAudit(db, { userId: user.id, entity: "travel_preferences", entityId: user.id, action: "update", after: d });
  revalidatePath("/", "layout");
  return { ok: true, message: "Préférences de déplacement enregistrées." };
}

export async function geocodeHomeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const address = String(formData.get("homeAddress") ?? "").trim();
  if (!address) return { ok: false, error: "Saisissez d'abord l'adresse du domicile." };
  if (!geocoderConfigured()) return { ok: false, error: "Aucun service de géocodage configuré : saisissez les coordonnées manuellement." };
  try {
    const res = await geocodeAddress(address);
    if (!res) return { ok: false, error: "Adresse introuvable avec une confiance suffisante." };
    await db
      .insert(travelPreferences)
      .values({ userId: user.id, homeAddress: address, homeLat: res.lat, homeLng: res.lng })
      .onConflictDoUpdate({ target: travelPreferences.userId, set: { homeAddress: address, homeLat: res.lat, homeLng: res.lng } });
    revalidatePath("/profil");
    return { ok: true, message: `Domicile géolocalisé : ${res.label}` };
  } catch (err) {
    return { ok: false, error: `Géocodage impossible : ${(err as Error).message}` };
  }
}

export async function setTemplateDayAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ templateId: z.uuid(), weekday: z.coerce.number().int().min(1).max(7), territoryIds: z.array(z.uuid()) })
    .safeParse({ templateId: formData.get("templateId"), weekday: formData.get("weekday"), territoryIds: formData.getAll("territoryIds") });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  try {
    await db.transaction((tx) => setTemplateDay(tx, user.id, parsed.data.templateId, parsed.data.weekday, parsed.data.territoryIds));
    await logAudit(db, { userId: user.id, entity: "weekly_preferences", entityId: parsed.data.templateId, action: "update", after: parsed.data });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Secteurs enregistrés." };
}

export async function setDefaultTemplateAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("templateId"));
  if (!id.success) return { ok: false, error: "Requête invalide." };
  await db.transaction((tx) => setDefaultTemplate(tx, user.id, id.data));
  revalidatePath("/", "layout");
  return { ok: true, message: "Modèle par défaut modifié." };
}

export async function assignWeekTemplateAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ weekStart: z.string().refine(isDayKey), templateId: z.union([z.uuid(), z.literal("")]) })
    .safeParse({ weekStart: formData.get("weekStart"), templateId: formData.get("templateId") });
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  await assignWeekTemplate(db, user.id, parsed.data.weekStart, parsed.data.templateId || null);
  await logAudit(db, { userId: user.id, entity: "week_template_assignment", entityId: parsed.data.weekStart, action: "update", after: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Modèle de la semaine modifié." };
}

export async function addTerritoryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const { DEPARTMENTS } = await import("@/domain/departments");
  const parsed = z
    .object({ code: z.string().refine((c) => c in DEPARTMENTS, "Département inconnu."), color: z.string().regex(/^#[0-9a-f]{6}$/i) })
    .safeParse({ code: formData.get("code"), color: formData.get("color") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  await db
    .insert(territories)
    .values({ userId: user.id, kind: "department", code: parsed.data.code, name: DEPARTMENTS[parsed.data.code]!, color: parsed.data.color })
    .onConflictDoUpdate({ target: [territories.userId, territories.kind, territories.code], set: { color: parsed.data.color, isActive: true } });
  revalidatePath("/profil");
  return { ok: true, message: "Département ajouté au territoire." };
}

export async function addFavoritePlaceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const optional = (max: number) =>
    z
      .string()
      .trim()
      .max(max)
      .transform((v) => v || null);
  const coord = z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
    .pipe(z.number().finite().nullable());
  const parsed = z
    .object({
      kind: z.enum(["hotel", "restaurant", "pool", "other"]),
      name: z.string().trim().min(1, "Nom requis.").max(120),
      address: optional(300),
      lat: coord,
      lng: coord,
      priceNote: optional(120),
      url: optional(500).pipe(z.url("Lien invalide.").nullable()),
      notes: optional(2000),
    })
    .safeParse(Object.fromEntries(["kind", "name", "address", "lat", "lng", "priceNote", "url", "notes"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const d = parsed.data;
  if ((d.lat === null) !== (d.lng === null)) return { ok: false, error: "Renseignez latitude et longitude, ou aucune des deux." };
  if (d.url && !/^https?:\/\//i.test(d.url)) return { ok: false, error: "Le lien doit commencer par http:// ou https://." };
  let { lat, lng } = d;
  if (lat === null && d.address && geocoderConfigured()) {
    const res = await geocodeAddress(d.address).catch(() => null);
    if (res) ({ lat, lng } = res);
  }
  await db.insert(favoritePlaces).values({ userId: user.id, ...d, lat, lng });
  revalidatePath("/profil");
  return { ok: true, message: "Lieu enregistré." };
}

export async function deleteFavoritePlaceAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requête invalide." };
  await db.delete(favoritePlaces).where(and(eq(favoritePlaces.id, id.data), eq(favoritePlaces.userId, user.id)));
  revalidatePath("/profil");
  return { ok: true, message: "Lieu supprimé." };
}

export async function setThemeAction(formData: FormData): Promise<void> {
  const theme = String(formData.get("theme") ?? "system");
  const store = await cookies();
  if (theme === "light" || theme === "dark") {
    store.set("lea_theme", theme, { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  } else {
    store.delete("lea_theme");
  }
  revalidatePath("/", "layout");
}

export async function setGamificationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const enabled = formData.get("enabled") === "on";
  await db.update(users).set({ gamificationEnabled: enabled }).where(eq(users.id, user.id));
  await logAudit(db, { userId: user.id, entity: "user_settings", entityId: user.id, action: "gamification", after: { enabled } });
  revalidatePath("/", "layout");
}
