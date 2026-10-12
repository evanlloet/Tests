/**
 * Lecture d'un fichier CSV de pharmacies (export maison, extraction FINESS
 * retraitée, export OpenStreetMap…). Les colonnes sont reconnues par leur nom ;
 * une valeur absente ou invalide reste vide : rien n'est deviné.
 */
import Papa from "papaparse";
import { departmentFromPostalCode } from "./departments";
import { isCategory, type Category } from "./frequency";
import { isInMetropolitanFrance, isValidLatLng } from "./geo";
import { normalizePharmacyName, normalizeText, pharmacyDedupeKey } from "./text";

type Column =
  | "name"
  | "legalName"
  | "externalId"
  | "address"
  | "postalCode"
  | "city"
  | "phone"
  | "lat"
  | "lng"
  | "category"
  | "revenue"
  | "potential"
  | "targetVisits"
  | "notes";

export const PHARMACY_COLUMN_ALIASES: Record<Column, string[]> = {
  name: ["nom", "nom commercial", "nom pharmacie", "pharmacie", "name", "enseigne", "denomination", "rs"],
  legalName: ["raison sociale", "rslongue", "denomination sociale", "legal name"],
  externalId: ["finess", "n finess", "no finess", "numero finess", "nofinesset", "finess et", "id externe", "identifiant externe", "osm id", "osm_id", "ref", "external id"],
  address: ["adresse", "adresse complete", "address", "rue", "voie", "adresse postale"],
  postalCode: ["code postal", "cp", "postcode", "postal code", "zip", "code_postal"],
  city: ["ville", "commune", "city", "localite", "libelle commune"],
  phone: ["telephone", "tel", "phone", "telephone fixe"],
  lat: ["latitude", "lat", "y"],
  lng: ["longitude", "lng", "lon", "long", "x"],
  category: ["categorie", "category", "classe", "abcd", "segment", "categorie abcd"],
  revenue: ["ca", "chiffre d affaires", "ca annuel", "chiffre affaires", "revenue", "ca n 1"],
  potential: ["potentiel", "potential"],
  targetVisits: ["frequence", "frequence cible", "visites par an", "nb visites an"],
  notes: ["notes", "commentaire", "commentaires", "observations"],
};

export type PharmacyImportRow = {
  line: number;
  name: string;
  normalizedName: string;
  dedupeKey: string;
  legalName: string | null;
  externalId: string | null;
  externalSource: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  departmentCode: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  category: Category | null;
  annualRevenue: number | null;
  potential: "fort" | "moyen" | "faible" | null;
  targetVisitsPerYear: number | null;
  notes: string | null;
};

export type PharmacyImportParse = {
  rows: PharmacyImportRow[];
  issues: { row: number; message: string }[];
  totalRows: number;
  detectedColumns: Partial<Record<Column, string>>;
  externalSource: string | null;
};

export class PharmacyImportError extends Error {}

export function parsePharmacyCsv(text: string): PharmacyImportParse {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", ",", "\t", "|"],
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const columns = mapColumns(headers);
  if (!columns.name) {
    throw new PharmacyImportError(
      `Colonne du nom introuvable. Colonnes reconnues pour le nom : ${PHARMACY_COLUMN_ALIASES.name.join(", ")}. Colonnes du fichier : ${headers.join(", ") || "aucune"}.`,
    );
  }
  const externalHeader = columns.externalId ? normalizeText(columns.externalId) : "";
  const externalSource = columns.externalId
    ? externalHeader.includes("finess")
      ? "finess"
      : externalHeader.includes("osm")
        ? "osm"
        : "externe"
    : null;

  const issues: PharmacyImportParse["issues"] = parsed.errors
    .slice(0, 50)
    .map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  const rows: PharmacyImportRow[] = [];
  const seenKeys = new Map<string, number>();
  const seenExternal = new Map<string, number>();

  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const get = (c: Column) => (columns[c] ? (raw[columns[c]!] ?? "").trim() : "");
    const name = get("name").replace(/\s+/g, " ");
    if (!name) {
      issues.push({ row: line, message: "Nom absent : ligne ignorée." });
      return;
    }
    const postalRaw = get("postalCode").replace(/\s/g, "");
    let postalCode: string | null = null;
    if (postalRaw) {
      const padded = /^\d{4}$/.test(postalRaw) ? `0${postalRaw}` : postalRaw;
      if (/^\d{5}$/.test(padded)) postalCode = padded;
      else issues.push({ row: line, message: `Code postal « ${postalRaw} » invalide : laissé vide.` });
    }
    const city = get("city") || null;

    let lat: number | null = parseDecimal(get("lat"));
    let lng: number | null = parseDecimal(get("lng"));
    if (lat !== null || lng !== null) {
      if (!isValidLatLng(lat, lng)) {
        issues.push({ row: line, message: "Coordonnées invalides : ignorées." });
        lat = lng = null;
      } else if (!isInMetropolitanFrance({ lat: lat!, lng: lng! }) && isInMetropolitanFrance({ lat: lng!, lng: lat! })) {
        issues.push({ row: line, message: "Latitude et longitude inversées : corrigées." });
        [lat, lng] = [lng, lat];
      }
    }

    const categoryRaw = get("category").toUpperCase();
    let category: Category | null = null;
    if (categoryRaw) {
      if (isCategory(categoryRaw)) category = categoryRaw;
      else issues.push({ row: line, message: `Catégorie « ${categoryRaw} » inconnue (attendu A, B, C ou D) : laissée vide.` });
    }
    const revenueRaw = get("revenue");
    let annualRevenue: number | null = null;
    if (revenueRaw) {
      annualRevenue = parseDecimal(revenueRaw.replace(/[€\s]|eur/gi, ""));
      if (annualRevenue === null || annualRevenue < 0) {
        issues.push({ row: line, message: `Chiffre d'affaires « ${revenueRaw} » illisible : laissé vide.` });
        annualRevenue = null;
      }
    }
    const potentialRaw = normalizeText(get("potential"));
    const potential = (["fort", "moyen", "faible"] as const).find((p) => p === potentialRaw) ?? null;
    if (potentialRaw && !potential) issues.push({ row: line, message: `Potentiel « ${get("potential")} » non reconnu (fort, moyen, faible) : laissé vide.` });
    const freqRaw = get("targetVisits");
    let targetVisitsPerYear: number | null = null;
    if (freqRaw) {
      const n = Number(freqRaw.replace(",", "."));
      if (Number.isInteger(n) && n >= 1 && n <= 52) targetVisitsPerYear = n;
      else issues.push({ row: line, message: `Fréquence « ${freqRaw} » invalide (entier de 1 à 52) : laissée vide.` });
    }

    const externalId = get("externalId").replace(/\s/g, "") || null;
    const dedupeKey = pharmacyDedupeKey(name, postalCode, city);
    if (externalId) {
      const prev = seenExternal.get(externalId);
      if (prev) {
        issues.push({ row: line, message: `Identifiant ${externalId} déjà présent ligne ${prev} : doublon ignoré.` });
        return;
      }
      seenExternal.set(externalId, line);
    }
    const prevKey = seenKeys.get(dedupeKey);
    if (prevKey) {
      issues.push({ row: line, message: `Même nom et même commune que la ligne ${prevKey} : doublon ignoré.` });
      return;
    }
    seenKeys.set(dedupeKey, line);

    rows.push({
      line,
      name,
      normalizedName: normalizePharmacyName(name),
      dedupeKey,
      legalName: get("legalName") || null,
      externalId,
      externalSource: externalId ? externalSource : null,
      addressLine: get("address") || null,
      postalCode,
      city,
      departmentCode: departmentFromPostalCode(postalCode),
      phone: get("phone") || null,
      lat,
      lng,
      category,
      annualRevenue,
      potential,
      targetVisitsPerYear,
      notes: get("notes") || null,
    });
  });

  return { rows, issues, totalRows: parsed.data.length, detectedColumns: columns, externalSource };
}

function mapColumns(headers: string[]): Partial<Record<Column, string>> {
  const out: Partial<Record<Column, string>> = {};
  const used = new Set<string>();
  for (const [column, aliases] of Object.entries(PHARMACY_COLUMN_ALIASES) as [Column, string[]][]) {
    const hit = headers.find((h) => !used.has(h) && aliases.includes(normalizeText(h)));
    if (hit) {
      out[column] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** « 1 234,5 » → 1234.5 ; null si illisible. */
export function parseDecimal(value: string): number | null {
  const v = value.replace(/\s| | /g, "");
  if (!v) return null;
  // La virgule est décimale si elle est le dernier séparateur (« 1.234,5 »), sinon séparateur de milliers.
  const normalized = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
