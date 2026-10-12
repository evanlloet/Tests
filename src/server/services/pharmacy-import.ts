import "server-only";
import { eq } from "drizzle-orm";
import { decodeTextFile } from "@/domain/calendar/decode";
import { sha256 } from "@/domain/calendar/keys";
import { parsePharmacyCsv, type PharmacyImportRow } from "@/domain/pharmacy-import";
import { pharmacyDedupeKey, normalizePharmacyName } from "@/domain/text";
import type { Db, DbOrTx } from "../db/client";
import { pharmacies, pharmacyImports, pharmacyMetrics } from "../db/schema";
import { logAudit } from "../repositories/audit";

export type PharmacyImportResult = {
  importId: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  issues: { row: number; message: string }[];
  detectedColumns: string[];
};

const IDENTITY_FIELDS = ["name", "legalName", "addressLine", "postalCode", "city", "departmentCode", "phone", "notes"] as const;

/**
 * Importe un CSV de pharmacies. Rejouable : une pharmacie est retrouvée par son
 * identifiant externe, sinon par sa clé (nom + code postal + commune). Une valeur
 * vide dans le fichier n'efface jamais une valeur existante.
 */
export async function importPharmacyCsv(
  db: Db,
  userId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<PharmacyImportResult> {
  const { text } = decodeTextFile(file.bytes);
  const parsed = parsePharmacyCsv(text);
  const issues = [...parsed.issues];
  const source = parsed.externalSource === "finess" ? "import_finess_csv" : parsed.externalSource === "osm" ? "import_osm_csv" : "import_csv";

  return db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(pharmacyImports)
      .values({ userId, filename: file.name.slice(0, 200), fileSha256: sha256(file.bytes), source })
      .returning({ id: pharmacyImports.id });
    const importId = imp!.id;

    const existing = await tx.select().from(pharmacies).where(eq(pharmacies.userId, userId));
    const metrics = await tx.select().from(pharmacyMetrics).where(eq(pharmacyMetrics.userId, userId));
    const metricsById = new Map(metrics.map((m) => [m.pharmacyId, m]));
    const byExternal = new Map(existing.filter((p) => p.externalId).map((p) => [`${p.externalSource}|${p.externalId}`, p]));
    const byKey = new Map(existing.map((p) => [p.dedupeKey, p]));

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const toInsert: { row: PharmacyImportRow }[] = [];

    for (const row of parsed.rows) {
      const match =
        (row.externalId ? byExternal.get(`${row.externalSource}|${row.externalId}`) : undefined) ?? byKey.get(row.dedupeKey);
      if (!match) {
        toInsert.push({ row });
        continue;
      }
      const patch: Partial<typeof pharmacies.$inferInsert> = {};
      for (const f of IDENTITY_FIELDS) {
        const value = row[f];
        if (value !== null && value !== undefined && value !== match[f]) (patch as Record<string, unknown>)[f] = value;
      }
      if (row.lat !== null && row.lng !== null && (row.lat !== match.lat || row.lng !== match.lng)) {
        Object.assign(patch, { lat: row.lat, lng: row.lng, geoPrecision: "exact", geoSource: source });
      }
      if (row.externalId && !match.externalId && !byExternal.has(`${row.externalSource}|${row.externalId}`)) {
        Object.assign(patch, { externalId: row.externalId, externalSource: row.externalSource });
      }
      if (patch.name || patch.postalCode || patch.city) {
        const newKey = pharmacyDedupeKey(patch.name ?? match.name, patch.postalCode ?? match.postalCode, patch.city ?? match.city);
        const holder = byKey.get(newKey);
        if (holder && holder.id !== match.id) {
          issues.push({ row: row.line, message: "Nom/commune identiques à une autre fiche : identité non modifiée." });
          delete patch.name;
          delete patch.postalCode;
          delete patch.city;
        } else {
          patch.dedupeKey = newKey;
          patch.normalizedName = normalizePharmacyName(patch.name ?? match.name);
        }
      }
      const metricsChanged = await upsertMetrics(tx, userId, match.id, row, metricsById.get(match.id), source);
      if (Object.keys(patch).length > 0) {
        await tx
          .update(pharmacies)
          .set({ ...patch, source: match.source, sourceImportId: importId, sourceUpdatedAt: new Date() })
          .where(eq(pharmacies.id, match.id));
        updated++;
      } else if (metricsChanged) {
        updated++;
      } else {
        unchanged++;
      }
    }

    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const inserted = await tx
        .insert(pharmacies)
        .values(
          chunk.map(({ row }) => ({
            userId,
            name: row.name,
            legalName: row.legalName,
            externalId: row.externalId,
            externalSource: row.externalSource,
            addressLine: row.addressLine,
            postalCode: row.postalCode,
            city: row.city,
            departmentCode: row.departmentCode,
            phone: row.phone,
            lat: row.lat,
            lng: row.lng,
            geoPrecision: row.lat !== null ? ("exact" as const) : null,
            geoSource: row.lat !== null ? source : null,
            dedupeKey: row.dedupeKey,
            normalizedName: row.normalizedName,
            notes: row.notes,
            source,
            sourceImportId: importId,
            sourceUpdatedAt: new Date(),
          })),
        )
        .returning({ id: pharmacies.id, dedupeKey: pharmacies.dedupeKey });
      const idByKey = new Map(inserted.map((r) => [r.dedupeKey, r.id]));
      for (const { row } of chunk) await upsertMetrics(tx, userId, idByKey.get(row.dedupeKey)!, row, undefined, source);
      created += inserted.length;
    }

    const skipped = parsed.totalRows - parsed.rows.length;
    await tx
      .update(pharmacyImports)
      .set({
        totalRows: parsed.totalRows,
        createdCount: created,
        updatedCount: updated,
        unchangedCount: unchanged,
        skippedCount: skipped,
        issues: issues.slice(0, 500),
      })
      .where(eq(pharmacyImports.id, importId));
    await logAudit(tx, {
      userId,
      entity: "pharmacy_import",
      entityId: importId,
      action: "import",
      after: { filename: file.name, created, updated, unchanged, skipped },
    });

    return {
      importId,
      totalRows: parsed.totalRows,
      created,
      updated,
      unchanged,
      skipped,
      issues,
      detectedColumns: Object.values(parsed.detectedColumns).filter(Boolean) as string[],
    };
  });
}

/** Met à jour les données commerciales fournies par le fichier (jamais d'effacement). */
async function upsertMetrics(
  tx: DbOrTx,
  userId: string,
  pharmacyId: string,
  row: PharmacyImportRow,
  current: typeof pharmacyMetrics.$inferSelect | undefined,
  source: string,
): Promise<boolean> {
  const patch: Partial<typeof pharmacyMetrics.$inferInsert> = {};
  if (row.category && row.category !== current?.category) patch.category = row.category;
  if (row.annualRevenue !== null && Number(current?.annualRevenue ?? NaN) !== row.annualRevenue) {
    patch.annualRevenue = row.annualRevenue.toFixed(2);
  }
  if (row.potential && row.potential !== current?.potential) patch.potential = row.potential;
  if (row.targetVisitsPerYear && row.targetVisitsPerYear !== current?.targetVisitsPerYear) {
    patch.targetVisitsPerYear = row.targetVisitsPerYear;
  }
  if (Object.keys(patch).length === 0) return false;
  await tx
    .insert(pharmacyMetrics)
    .values({ pharmacyId, userId, source, ...patch })
    .onConflictDoUpdate({ target: pharmacyMetrics.pharmacyId, set: { ...patch, source } });
  return true;
}
