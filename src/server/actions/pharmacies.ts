"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { departmentFromPostalCode } from "@/domain/departments";
import { isInMetropolitanFrance } from "@/domain/geo";
import { normalizePharmacyName, pharmacyDedupeKey } from "@/domain/text";
import { geocodeAddress, geocoderConfigured } from "@/integrations/geocoding/geoplateforme";
import { requireUser } from "../auth/session";
import { db } from "../db/client";
import { pharmacies, pharmacyMetrics, pharmacyPreferences } from "../db/schema";
import { logAudit } from "../repositories/audit";
import { importPharmacyCsv, type PharmacyImportResult } from "../services/pharmacy-import";
import { readUpload, toActionError, type ActionResult } from "./result";

export async function importPharmaciesAction(_prev: ActionResult<PharmacyImportResult> | null, formData: FormData): Promise<ActionResult<PharmacyImportResult>> {
  const user = await requireUser();
  const file = await readUpload(formData.get("file"), [".csv", ".txt"]);
  if (typeof file === "string") return { ok: false, error: file };
  try {
    const result = await importPharmacyCsv(db, user.id, file);
    revalidatePath("/pharmacies");
    return { ok: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();
const optionalNumber = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .pipe(z.number().finite().nullable());

const identitySchema = z.object({
  name: z.string().trim().min(2, "Nom requis.").max(200),
  legalName: optionalText(200),
  addressLine: optionalText(300),
  postalCode: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().regex(/^\d{5}$/, "Code postal à 5 chiffres.").nullable()),
  city: optionalText(120),
  phone: optionalText(40),
  externalId: optionalText(40),
  notes: optionalText(4000),
  lat: optionalNumber,
  lng: optionalNumber,
});

function readIdentity(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return identitySchema.safeParse({
    name: get("name"),
    legalName: get("legalName"),
    addressLine: get("addressLine"),
    postalCode: get("postalCode"),
    city: get("city"),
    phone: get("phone"),
    externalId: get("externalId"),
    notes: get("notes"),
    lat: get("lat"),
    lng: get("lng"),
  });
}

function checkCoordinates(lat: number | null, lng: number | null): string | null {
  if ((lat === null) !== (lng === null)) return "Renseignez la latitude et la longitude, ou aucune des deux.";
  if (lat !== null && lng !== null && !isInMetropolitanFrance({ lat, lng })) return "Coordonnées hors de France métropolitaine : vérifiez-les.";
  return null;
}

export async function createPharmacyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = readIdentity(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const d = parsed.data;
  const coordError = checkCoordinates(d.lat, d.lng);
  if (coordError) return { ok: false, error: coordError };
  const dedupeKey = pharmacyDedupeKey(d.name, d.postalCode, d.city);
  const [dup] = await db
    .select({ id: pharmacies.id })
    .from(pharmacies)
    .where(and(eq(pharmacies.userId, user.id), eq(pharmacies.dedupeKey, dedupeKey)));
  if (dup) return { ok: false, error: "Une pharmacie avec ce nom existe déjà dans cette commune." };
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(pharmacies)
        .values({
          userId: user.id,
          ...d,
          externalSource: d.externalId ? "manuel" : null,
          departmentCode: departmentFromPostalCode(d.postalCode),
          geoPrecision: d.lat !== null ? "exact" : null,
          geoSource: d.lat !== null ? "saisie manuelle" : null,
          dedupeKey,
          normalizedName: normalizePharmacyName(d.name),
          source: "manual",
        })
        .returning();
      await logAudit(tx, { userId: user.id, entity: "pharmacy", entityId: created!.id, action: "create", after: created });
      return created!.id;
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/pharmacies");
  redirect(`/pharmacies/${id}`);
}

export async function updatePharmacyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Fiche introuvable." };
  const parsed = readIdentity(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const d = parsed.data;
  const coordError = checkCoordinates(d.lat, d.lng);
  if (coordError) return { ok: false, error: coordError };
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(pharmacies).where(and(eq(pharmacies.id, id.data), eq(pharmacies.userId, user.id)));
      if (!current) throw new Error("not found");
      const dedupeKey = pharmacyDedupeKey(d.name, d.postalCode, d.city);
      const [dup] = await tx
        .select({ id: pharmacies.id })
        .from(pharmacies)
        .where(and(eq(pharmacies.userId, user.id), eq(pharmacies.dedupeKey, dedupeKey)));
      if (dup && dup.id !== current.id) throw new DuplicateError();
      const coordsChanged = d.lat !== current.lat || d.lng !== current.lng;
      const patch = {
        ...d,
        externalSource: d.externalId && d.externalId !== current.externalId ? (current.externalSource ?? "manuel") : current.externalSource,
        departmentCode: departmentFromPostalCode(d.postalCode),
        dedupeKey,
        normalizedName: normalizePharmacyName(d.name),
        ...(coordsChanged
          ? { geoPrecision: d.lat !== null ? ("exact" as const) : null, geoSource: d.lat !== null ? "saisie manuelle" : null }
          : {}),
      };
      await tx.update(pharmacies).set(patch).where(eq(pharmacies.id, current.id));
      await logAudit(tx, { userId: user.id, entity: "pharmacy", entityId: current.id, action: "update", before: current, after: patch });
    });
  } catch (err) {
    if (err instanceof DuplicateError) return { ok: false, error: "Une autre fiche porte déjà ce nom dans cette commune." };
    return toActionError(err);
  }
  revalidatePath(`/pharmacies/${id.data}`);
  return { ok: true, message: "Fiche enregistrée." };
}

class DuplicateError extends Error {}

const metricsSchema = z.object({
  id: z.uuid(),
  category: z.enum(["A", "B", "C", "D", ""]).transform((v) => (v === "" ? null : v)),
  annualRevenue: optionalNumber.pipe(z.number().min(0, "Chiffre d'affaires négatif.").nullable()),
  potential: z.enum(["fort", "moyen", "faible", ""]).transform((v) => (v === "" ? null : v)),
  targetVisitsPerYear: optionalNumber.pipe(z.number().int("Fréquence entière attendue.").min(1).max(52).nullable()),
  size: optionalText(60),
});

export async function updateMetricsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = metricsSchema.safeParse(Object.fromEntries(["id", "category", "annualRevenue", "potential", "targetVisitsPerYear", "size"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const { id, annualRevenue, ...rest } = parsed.data;
  const [owned] = await db.select({ id: pharmacies.id }).from(pharmacies).where(and(eq(pharmacies.id, id), eq(pharmacies.userId, user.id)));
  if (!owned) return { ok: false, error: "Fiche introuvable." };
  const values = { ...rest, annualRevenue: annualRevenue === null ? null : annualRevenue.toFixed(2), source: "manual" };
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(pharmacyMetrics).where(eq(pharmacyMetrics.pharmacyId, id));
    await tx
      .insert(pharmacyMetrics)
      .values({ pharmacyId: id, userId: user.id, ...values })
      .onConflictDoUpdate({ target: pharmacyMetrics.pharmacyId, set: values });
    await logAudit(tx, { userId: user.id, entity: "pharmacy_metrics", entityId: id, action: "update", before: before ?? null, after: values });
  });
  revalidatePath(`/pharmacies/${id}`);
  return { ok: true, message: "Données commerciales enregistrées." };
}

const timeOrNull = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\d{2}:\d{2}$/, "Heure au format HH:MM.").nullable());

export async function updatePreferencesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const schema = z.object({
    id: z.uuid(),
    preferredWeekdays: z.array(z.coerce.number().int().min(1).max(7)),
    excludedWeekdays: z.array(z.coerce.number().int().min(1).max(7)),
    preferredStart: timeOrNull,
    preferredEnd: timeOrNull,
    visitMinutes: optionalNumber.pipe(z.number().int().min(5).max(480).nullable()),
    constraints: optionalText(2000),
  });
  const parsed = schema.safeParse({
    id: formData.get("id"),
    preferredWeekdays: formData.getAll("preferredWeekdays"),
    excludedWeekdays: formData.getAll("excludedWeekdays"),
    preferredStart: String(formData.get("preferredStart") ?? ""),
    preferredEnd: String(formData.get("preferredEnd") ?? ""),
    visitMinutes: String(formData.get("visitMinutes") ?? ""),
    constraints: String(formData.get("constraints") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;
  if (values.preferredWeekdays.some((d) => values.excludedWeekdays.includes(d))) {
    return { ok: false, error: "Un même jour ne peut pas être à la fois préféré et exclu." };
  }
  if (values.preferredStart && values.preferredEnd && values.preferredStart >= values.preferredEnd) {
    return { ok: false, error: "L'heure de début doit précéder l'heure de fin." };
  }
  const [owned] = await db.select({ id: pharmacies.id }).from(pharmacies).where(and(eq(pharmacies.id, id), eq(pharmacies.userId, user.id)));
  if (!owned) return { ok: false, error: "Fiche introuvable." };
  await db.transaction(async (tx) => {
    await tx
      .insert(pharmacyPreferences)
      .values({ pharmacyId: id, userId: user.id, ...values })
      .onConflictDoUpdate({ target: pharmacyPreferences.pharmacyId, set: values });
    await logAudit(tx, { userId: user.id, entity: "pharmacy_preferences", entityId: id, action: "update", after: values });
  });
  revalidatePath(`/pharmacies/${id}`);
  return { ok: true, message: "Disponibilités enregistrées." };
}

export async function geocodePharmacyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Fiche introuvable." };
  if (!geocoderConfigured()) return { ok: false, error: "Aucun service de géocodage n'est configuré (GEOCODER_URL)." };
  const [p] = await db.select().from(pharmacies).where(and(eq(pharmacies.id, id.data), eq(pharmacies.userId, user.id)));
  if (!p) return { ok: false, error: "Fiche introuvable." };
  if (!p.addressLine && !p.city) return { ok: false, error: "Adresse et commune absentes : rien à géocoder." };
  try {
    const res = await geocodeAddress([p.addressLine, p.postalCode, p.city].filter(Boolean).join(" "), p.postalCode);
    if (!res) return { ok: false, error: "Adresse non trouvée avec une confiance suffisante : saisissez les coordonnées manuellement." };
    await db
      .update(pharmacies)
      .set({ lat: res.lat, lng: res.lng, geoPrecision: res.precision, geoSource: `géocodage (score ${res.score.toFixed(2)})` })
      .where(eq(pharmacies.id, p.id));
    await logAudit(db, { userId: user.id, entity: "pharmacy", entityId: p.id, action: "geocode", before: { lat: p.lat, lng: p.lng }, after: res });
    revalidatePath(`/pharmacies/${p.id}`);
    return { ok: true, message: `Géolocalisée : ${res.label}` };
  } catch (err) {
    return { ok: false, error: `Géocodage impossible : ${(err as Error).message}` };
  }
}
