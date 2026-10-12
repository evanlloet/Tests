import "server-only";
import { eq } from "drizzle-orm";
import { decodeTextFile } from "@/domain/calendar/decode";
import { sha256 } from "@/domain/calendar/keys";
import { locateCommune } from "@/domain/communes";
import { parsePharmacyFile, PHARMACY_FIELDS, type ColumnMapping, type PharmacyImportRow } from "@/domain/pharmacy-import";
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
  format: "csv" | "xlsx";
  /** Correspondance colonnes du fichier → champs de Léa */
  mapping: { header: string; label: string }[];
  /** Fiches placées au centre de leur commune faute d'adresse ou de coordonnées */
  locatedByCommune: number;
};

const IDENTITY_FIELDS = [
  "name",
  "legalName",
  "addressLine",
  "postalCode",
  "city",
  "departmentCode",
  "phone",
  "email",
  "channel",
  "salesZone",
  "buyingGroup",
  "notes",
] as const;

/** Préfixe de `geo_source` pour une position approximative au centre de la commune. */
export const COMMUNE_GEO_SOURCE = "centre_commune";

function mappingLabels(mapping: ColumnMapping) {
  return mapping.map(({ header, field }) => ({
    header,
    label:
      field === "extra" ? "Conservée telle quelle (autres informations)" : field === "derived" ? "Recalculée par Léa" : PHARMACY_FIELDS[field].label,
  }));
}

/** Position au centre de la commune, ou null si la commune n'est pas reconnue. */
function communePosition(postalCode: string | null, city: string | null) {
  const loc = locateCommune(postalCode, city);
  return loc ? { lat: loc.lat, lng: loc.lng, geoPrecision: "city" as const, geoSource: `${COMMUNE_GEO_SOURCE}:${loc.basis}:${loc.name}` } : null;
}

const sameList = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((v, i) => v === b?.[i]);

/**
 * Importe un fichier de pharmacies (CSV ou Excel). Rejouable : une pharmacie est
 * retrouvée par son identifiant externe (code client, FINESS…), sinon par sa clé
 * (nom + code postal + commune). Une valeur vide dans le fichier n'efface jamais
 * une valeur existante. Sans adresse ni coordonnées, la fiche est placée au centre
 * de sa commune (position marquée approximative).
 */
export async function importPharmacyFile(
  db: Db,
  userId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<PharmacyImportResult> {
  const parsed = parsePharmacyFile(file.bytes, (b) => decodeTextFile(b).text);
  const issues = [...parsed.issues];
  const ext = parsed.format === "xlsx" ? "xlsx" : "csv";
  const source =
    parsed.externalSource === "finess" ? `import_finess_${ext}` : parsed.externalSource === "osm" ? `import_osm_${ext}` : `import_${ext}`;
  const lineOf = new Map(parsed.rows.map((r) => [r, r.line]));
  let locatedByCommune = 0;
  const locate = (row: PharmacyImportRow) => {
    const pos = communePosition(row.postalCode, row.city);
    if (pos) locatedByCommune++;
    else if (row.postalCode || row.city)
      issues.push({ row: lineOf.get(row)!, message: `Commune « ${[row.postalCode, row.city].filter(Boolean).join(" ")} » introuvable : fiche non placée sur la carte.` });
    return pos;
  };

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
    // Clé enregistrée et clé recalculée (les règles de normalisation peuvent évoluer).
    const byKey = new Map(existing.flatMap((p) => [[p.dedupeKey, p] as const, [pharmacyDedupeKey(p.name, p.postalCode, p.city), p] as const]));

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
      if (row.targeting !== null && !sameList(row.targeting, match.targeting)) patch.targeting = row.targeting;
      if (row.extra !== null) {
        const merged = { ...(match.extra ?? {}), ...row.extra };
        if (JSON.stringify(merged) !== JSON.stringify(match.extra ?? {})) patch.extra = merged;
      }
      if (row.lat !== null && row.lng !== null && (row.lat !== match.lat || row.lng !== match.lng)) {
        Object.assign(patch, { lat: row.lat, lng: row.lng, geoPrecision: "exact", geoSource: source });
      } else if (row.lat === null && (match.lat === null || (match.geoSource?.startsWith(COMMUNE_GEO_SOURCE) && (patch.postalCode || patch.city)))) {
        // Jamais de centre de commune à la place d'une position précise.
        const pos = locate({ ...row, postalCode: patch.postalCode ?? match.postalCode, city: patch.city ?? match.city });
        if (pos && (pos.lat !== match.lat || pos.lng !== match.lng)) Object.assign(patch, pos);
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
            email: row.email,
            channel: row.channel,
            salesZone: row.salesZone,
            buyingGroup: row.buyingGroup,
            targeting: row.targeting,
            extra: row.extra,
            ...(row.lat !== null
              ? { lat: row.lat, lng: row.lng, geoPrecision: "exact" as const, geoSource: source }
              : (locate(row) ?? { lat: null, lng: null, geoPrecision: null, geoSource: null })),
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
      after: { filename: file.name, format: parsed.format, created, updated, unchanged, skipped, locatedByCommune },
    });

    return {
      importId,
      totalRows: parsed.totalRows,
      created,
      updated,
      unchanged,
      skipped,
      issues,
      format: parsed.format,
      mapping: mappingLabels(parsed.mapping),
      locatedByCommune,
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
  const money = (v: number | null, prev: string | null | undefined) => (v !== null && Number(prev ?? NaN) !== v ? v.toFixed(2) : undefined);
  const prevYear = money(row.revenuePreviousYear, current?.revenuePreviousYear);
  if (prevYear !== undefined) patch.revenuePreviousYear = prevYear;
  const curYear = money(row.revenueCurrentYear, current?.revenueCurrentYear);
  if (curYear !== undefined) patch.revenueCurrentYear = curYear;
  if (row.lastOrderOn && row.lastOrderOn !== current?.lastOrderOn) patch.lastOrderOn = row.lastOrderOn;
  if (row.plannedVisitOn && row.plannedVisitOn !== current?.plannedVisitOn) patch.plannedVisitOn = row.plannedVisitOn;
  if (Object.keys(patch).length === 0) return false;
  await tx
    .insert(pharmacyMetrics)
    .values({ pharmacyId, userId, source, ...patch })
    .onConflictDoUpdate({ target: pharmacyMetrics.pharmacyId, set: { ...patch, source } });
  return true;
}
