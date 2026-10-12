/**
 * Lecture d'un fichier de pharmacies / clients : CSV (export maison, extraction
 * FINESS retraitée, export OpenStreetMap…) ou classeur Excel (.xlsx, par exemple
 * l'export « CLIENTS » du laboratoire). Les colonnes sont reconnues par leur nom ;
 * une valeur absente ou invalide reste vide : rien n'est deviné.
 */
import Papa from "papaparse";
import { departmentFromPostalCode, NEIGHBOURING_DEPARTMENTS } from "./departments";
import { isCategory, type Category } from "./frequency";
import { isInMetropolitanFrance, isValidLatLng } from "./geo";
import { normalizePharmacyName, normalizeText, pharmacyDedupeKey, readablePharmacyName } from "./text";
import { isDayKey, type DayKey } from "./time";
import { cellText, firstDataSheet, isXlsx, readXlsx } from "./xlsx";

export type PharmacyField =
  | "name"
  | "legalName"
  | "externalId"
  | "channel"
  | "address"
  | "postalCode"
  | "city"
  | "phone"
  | "email"
  | "lat"
  | "lng"
  | "salesZone"
  | "buyingGroup"
  | "category"
  | "targeting"
  | "revenue"
  | "revenuePreviousYear"
  | "revenueCurrentYear"
  | "lastOrder"
  | "plannedVisit"
  | "potential"
  | "targetVisits"
  | "notes";

type FieldRule = {
  label: string;
  /** En-têtes reconnus tels quels (comparés sans accents, majuscules ni ponctuation) */
  aliases: string[];
  /** Reconnaissance plus souple, appliquée après les correspondances exactes */
  match?: (header: string) => boolean;
  /** Plusieurs colonnes peuvent alimenter ce champ (ciblages) */
  multi?: boolean;
};

const words = (h: string) => h.split(" ");
const isRevenueHeader = (h: string) => ["ca", "caf", "chiffre"].includes(words(h)[0]!);

/** Champs de Léa et en-têtes reconnus, dans l'ordre de priorité. */
export const PHARMACY_FIELDS: Record<PharmacyField, FieldRule> = {
  name: {
    label: "Nom (obligatoire)",
    aliases: ["nom", "nom client", "nom commercial", "nom pharmacie", "pharmacie", "client", "name", "enseigne", "denomination", "rs"],
  },
  legalName: { label: "Raison sociale", aliases: ["raison sociale", "rslongue", "denomination sociale", "legal name"] },
  externalId: {
    label: "Code client / identifiant (FINESS, OSM…)",
    aliases: [
      "code",
      "code client",
      "n client",
      "no client",
      "numero client",
      "id client",
      "finess",
      "n finess",
      "no finess",
      "numero finess",
      "nofinesset",
      "finess et",
      "id externe",
      "identifiant externe",
      "osm id",
      "osm_id",
      "ref",
      "external id",
    ],
  },
  channel: {
    label: "Canal (pharmacie, GMS…)",
    aliases: ["canal", "sous canal", "canal client", "type client", "type de client", "circuit"],
    match: (h) => words(h).includes("canal"),
  },
  address: { label: "Adresse", aliases: ["adresse", "adresse complete", "address", "rue", "voie", "adresse postale"] },
  postalCode: { label: "Code postal", aliases: ["code postal", "cp", "postcode", "postal code", "zip", "code_postal"] },
  city: { label: "Commune", aliases: ["ville", "commune", "city", "localite", "libelle commune"] },
  phone: {
    label: "Téléphone",
    aliases: ["telephone", "tel", "phone", "telephone fixe", "n tel", "no tel", "numero de telephone", "n telephone"],
  },
  email: {
    label: "E-mail",
    aliases: ["email", "e mail", "mail", "adresse mail", "adresse email", "adresse e mail", "courriel"],
    match: (h) => words(h).includes("mail") || words(h).includes("email"),
  },
  lat: { label: "Latitude", aliases: ["latitude", "lat", "y"] },
  lng: { label: "Longitude", aliases: ["longitude", "lng", "lon", "long", "x"] },
  salesZone: {
    label: "Zone commerciale (UGA)",
    aliases: ["uga", "code uga", "zone", "zone commerciale", "code zone"],
    match: (h) => words(h).includes("uga"),
  },
  buyingGroup: {
    label: "Groupement",
    aliases: ["groupement", "groupement client", "lib groupement client", "enseigne groupement"],
    match: (h) => words(h).includes("groupement"),
  },
  category: {
    label: "Catégorie A/B/C/D (ciblage)",
    aliases: ["categorie", "category", "classe", "abcd", "segment", "categorie abcd", "ciblage", "ciblage client"],
    match: (h) => h.startsWith("ciblage client"),
  },
  targeting: {
    label: "Autres ciblages (Premium, Perfect Store…)",
    aliases: [],
    match: (h) => h.startsWith("ciblage "),
    multi: true,
  },
  revenue: { label: "Chiffre d'affaires annuel", aliases: ["ca", "chiffre d affaires", "ca annuel", "chiffre affaires", "revenue"] },
  revenuePreviousYear: {
    label: "CA de l'année précédente (A-1)",
    aliases: ["ca n 1", "ca a 1", "caf a 1"],
    match: (h) => isRevenueHeader(h) && / (a|n) 1$/.test(h),
  },
  revenueCurrentYear: {
    label: "CA de l'année en cours (A)",
    aliases: ["ca n", "ca a", "caf a"],
    match: (h) => isRevenueHeader(h) && / (a|n)$/.test(h),
  },
  lastOrder: {
    label: "Date de dernière commande",
    aliases: ["derniere commande", "date derniere commande"],
    match: (h) => h.includes("derniere commande"),
  },
  plannedVisit: {
    label: "Date de prochaine visite (fichier)",
    aliases: ["prochaine visite", "date prochaine visite"],
    match: (h) => h.includes("prochaine visite"),
  },
  potential: { label: "Potentiel (fort/moyen/faible)", aliases: ["potentiel", "potential"] },
  targetVisits: { label: "Visites par an", aliases: ["frequence", "frequence cible", "visites par an", "nb visites an"] },
  notes: { label: "Notes", aliases: ["notes", "commentaire", "commentaires", "observations"] },
};

/** Colonnes calculées par Léa à partir des autres : lues mais pas stockées. */
const DERIVED = (h: string) => words(h)[0] === "evol" || h.startsWith("evolution");

export type ColumnMapping = { header: string; field: PharmacyField | "derived" | "extra" }[];

export type PharmacyImportRow = {
  line: number;
  name: string;
  normalizedName: string;
  dedupeKey: string;
  legalName: string | null;
  externalId: string | null;
  externalSource: string | null;
  channel: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  departmentCode: string | null;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  salesZone: string | null;
  buyingGroup: string | null;
  /** null : aucune colonne de ciblage dans le fichier ; [] : colonnes présentes, aucun ciblage */
  targeting: string[] | null;
  category: Category | null;
  annualRevenue: number | null;
  revenuePreviousYear: number | null;
  revenueCurrentYear: number | null;
  lastOrderOn: DayKey | null;
  plannedVisitOn: DayKey | null;
  potential: "fort" | "moyen" | "faible" | null;
  targetVisitsPerYear: number | null;
  notes: string | null;
  /** Colonnes du fichier sans équivalent dans Léa, conservées telles quelles */
  extra: Record<string, string> | null;
};

export type PharmacyImportParse = {
  rows: PharmacyImportRow[];
  issues: { row: number; message: string }[];
  totalRows: number;
  mapping: ColumnMapping;
  externalSource: string | null;
  format: "csv" | "xlsx";
};

export class PharmacyImportError extends Error {}

/** Fichier CSV ou Excel (.xlsx), reconnu par son contenu. */
export function parsePharmacyFile(bytes: Uint8Array, decodeText: (b: Uint8Array) => string): PharmacyImportParse {
  if (isXlsx(bytes)) {
    const sheet = firstDataSheet(readXlsx(bytes));
    const rows = sheet.rows.map((r) => r.map(cellText));
    // L'en-tête est la première ligne (parmi les 10 premières) où l'on reconnaît une colonne de nom.
    const headerIndex = rows.slice(0, 10).findIndex((r) => mapColumns(r.map((h) => h.trim())).columns.name);
    if (headerIndex < 0) throw missingName(rows[0] ?? []);
    const headers = rows[headerIndex]!.map((h) => h.trim());
    const records = rows
      .slice(headerIndex + 1)
      .map((r, i) => ({ line: headerIndex + i + 2, values: Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ""])) }))
      .filter((r) => Object.values(r.values).some((v) => v.trim() !== ""));
    return { ...parseTable(headers, records, []), format: "xlsx" };
  }
  return parsePharmacyCsv(decodeText(bytes));
}

export function parsePharmacyCsv(text: string): PharmacyImportParse {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", ",", "\t", "|"],
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const records = parsed.data.map((values, i) => ({ line: i + 2, values }));
  const issues = parsed.errors.slice(0, 50).map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  return { ...parseTable(headers, records, issues), format: "csv" };
}

const missingName = (headers: string[]) =>
  new PharmacyImportError(
    `Colonne du nom introuvable. Colonnes reconnues pour le nom : ${PHARMACY_FIELDS.name.aliases.join(", ")}. Colonnes du fichier : ${headers.filter(Boolean).join(", ") || "aucune"}.`,
  );

const BLANKS = new Set(["", "-", "–", "—", "n/a", "na", "nc", "#n/a", "null", "?"]);
const blank = (v: string) => BLANKS.has(v.trim().toLowerCase());

function parseTable(
  headers: string[],
  records: { line: number; values: Record<string, string> }[],
  initialIssues: { row: number; message: string }[],
): Omit<PharmacyImportParse, "format"> {
  const { columns, targeting, mapping } = mapColumns(headers);
  if (!columns.name) throw missingName(headers);
  const externalSource = columns.externalId ? externalSourceOf(normalizeText(columns.externalId)) : null;
  const extraHeaders = mapping.filter((m) => m.field === "extra").map((m) => m.header);

  const issues = [...initialIssues];
  const rows: PharmacyImportRow[] = [];
  const seenKeys = new Map<string, number>();
  const seenExternal = new Map<string, number>();

  for (const { line, values: raw } of records) {
    const get = (c: PharmacyField) => {
      const v = columns[c] ? (raw[columns[c]!] ?? "").trim() : "";
      return blank(v) ? "" : v;
    };
    const rawName = get("name").replace(/\s+/g, " ");
    if (!rawName) {
      issues.push({ row: line, message: "Nom absent : ligne ignorée." });
      continue;
    }
    const name = readablePharmacyName(rawName);
    const legalName = get("legalName") || (startsWithLegalForm(rawName) ? rawName : null);

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
    const money = (field: PharmacyField, label: string, allowNegative: boolean) => {
      const v = get(field);
      if (!v) return null;
      const n = parseDecimal(v.replace(/[€\s]|eur/gi, ""));
      if (n === null || (!allowNegative && n < 0)) {
        issues.push({ row: line, message: `${label} « ${v} » illisible : laissé vide.` });
        return null;
      }
      return n;
    };
    const annualRevenue = money("revenue", "Chiffre d'affaires", false);
    // Un CA de période peut être négatif (avoirs) : il est conservé tel quel.
    const revenuePreviousYear = money("revenuePreviousYear", "CA A-1", true);
    const revenueCurrentYear = money("revenueCurrentYear", "CA A", true);

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

    const date = (field: PharmacyField, label: string) => {
      const v = get(field);
      if (!v) return null;
      const d = parseDay(v);
      if (!d) issues.push({ row: line, message: `${label} « ${v} » illisible : laissée vide.` });
      return d;
    };
    const lastOrderOn = date("lastOrder", "Date de dernière commande");
    const plannedVisitOn = date("plannedVisit", "Date de prochaine visite");

    const emailRaw = get("email");
    let email: string | null = null;
    if (emailRaw) {
      if (emailRaw.split(/[;,\s]+/).filter(Boolean).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) email = emailRaw;
      else issues.push({ row: line, message: `E-mail « ${emailRaw} » invalide : laissé vide.` });
    }

    const salesZone = get("salesZone").toUpperCase() || null;
    const departmentCode = departmentFromPostalCode(postalCode);
    // Une zone peut déborder sur un département voisin ; au-delà, le code postal est suspect.
    const zoneDepartment = salesZone?.match(/^\d\d/)?.[0];
    const neighbours = zoneDepartment ? NEIGHBOURING_DEPARTMENTS[zoneDepartment] : undefined;
    if (departmentCode && zoneDepartment && neighbours && departmentCode !== zoneDepartment && !neighbours.includes(departmentCode)) {
      issues.push({
        row: line,
        message: `Code postal ${postalCode} (département ${departmentCode}) éloigné de la zone ${salesZone} : adresse à vérifier.`,
      });
    }

    const tags = targeting.length
      ? targeting.flatMap((h) => {
          const v = (raw[h] ?? "").trim();
          return blank(v) ? [] : [targetingTag(h, v)];
        })
      : null;

    const extraEntries = extraHeaders.map((h) => [h, (raw[h] ?? "").trim()] as const).filter(([, v]) => !blank(v));
    const externalId = get("externalId").replace(/\s/g, "") || null;
    const dedupeKey = pharmacyDedupeKey(name, postalCode, city);
    if (externalId) {
      const prev = seenExternal.get(externalId);
      if (prev) {
        issues.push({ row: line, message: `Identifiant ${externalId} déjà présent ligne ${prev} : doublon ignoré.` });
        continue;
      }
      seenExternal.set(externalId, line);
    }
    const prevKey = seenKeys.get(dedupeKey);
    if (prevKey) {
      issues.push({ row: line, message: `Même nom et même commune que la ligne ${prevKey} : doublon ignoré.` });
      continue;
    }
    seenKeys.set(dedupeKey, line);

    rows.push({
      line,
      name,
      normalizedName: normalizePharmacyName(name),
      dedupeKey,
      legalName,
      externalId,
      externalSource: externalId ? externalSource : null,
      channel: channelLabel(get("channel")),
      addressLine: get("address") || null,
      postalCode,
      city,
      departmentCode,
      phone: get("phone") || null,
      email,
      lat,
      lng,
      salesZone,
      buyingGroup: get("buyingGroup") || null,
      targeting: tags,
      category,
      annualRevenue,
      revenuePreviousYear,
      revenueCurrentYear,
      lastOrderOn,
      plannedVisitOn,
      potential,
      targetVisitsPerYear,
      notes: get("notes") || null,
      extra: extraEntries.length ? Object.fromEntries(extraEntries) : null,
    });
  }

  return { rows, issues, totalRows: records.length, mapping, externalSource };
}

function mapColumns(headers: string[]) {
  const columns: Partial<Record<PharmacyField, string>> = {};
  const targeting: string[] = [];
  const used = new Set<string>();
  const fields = Object.entries(PHARMACY_FIELDS) as [PharmacyField, FieldRule][];
  const usable = headers.filter((h) => h.trim() !== "");
  // 1. En-têtes exacts, puis 2. reconnaissance souple
  for (const [field, rule] of fields) {
    const hit = usable.find((h) => !used.has(h) && rule.aliases.includes(normalizeText(h)));
    if (hit) {
      columns[field] = hit;
      used.add(hit);
    }
  }
  for (const [field, rule] of fields) {
    if (!rule.match) continue;
    for (const h of usable) {
      if (used.has(h) || !rule.match(normalizeText(h))) continue;
      if (rule.multi) {
        targeting.push(h);
        used.add(h);
      } else if (!columns[field]) {
        columns[field] = h;
        used.add(h);
      }
    }
  }
  const fieldOf = new Map<string, PharmacyField>(Object.entries(columns).map(([f, h]) => [h, f as PharmacyField]));
  const mapping: ColumnMapping = usable.map((h) => ({
    header: h,
    field: fieldOf.get(h) ?? (targeting.includes(h) ? "targeting" : DERIVED(normalizeText(h)) ? "derived" : "extra"),
  }));
  return { columns, targeting, mapping };
}

function externalSourceOf(header: string): string {
  if (header.includes("finess")) return "finess";
  if (header.includes("osm")) return "osm";
  if (header === "code" || header.includes("client")) return "code_client";
  return "externe";
}

function startsWithLegalForm(name: string): boolean {
  return /^(selarl|selas|selafa|selca|sel|sarl|sas|sasu|sa|snc|eurl|scp|spfpl)\s/i.test(name);
}

/** « PHARMACIES » → « Pharmacie », « GMS » → « GMS ». */
function channelLabel(raw: string): string | null {
  const n = normalizeText(raw);
  if (!n) return null;
  if (n === "pharmacie" || n === "pharmacies" || n === "officine" || n === "officines") return "Pharmacie";
  if (n === "parapharmacie" || n === "parapharmacies") return "Parapharmacie";
  if (raw.length <= 5) return raw.toUpperCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/**
 * Libellé d'un ciblage : « Ciblage Premium » = « P » → « Premium » ;
 * une valeur qui n'est pas l'initiale du libellé est gardée entre parenthèses
 * (« Ciblage GC » = « R » → « GC (R) ») : sa signification n'est pas devinée.
 */
function targetingTag(header: string, value: string): string {
  const label = header.trim().replace(/^ciblage\s+/i, "").trim() || header.trim();
  const v = normalizeText(value);
  const initials = normalizeText(label)
    .split(" ")
    .map((w) => w[0]);
  return ["x", "oui", "o", "1", "y", "yes", "vrai"].includes(v) || (v.length === 1 && initials.includes(v)) ? label : `${label} (${value})`;
}

/** « 2026-08-31 », « 31/08/2026 », « 31/08/26 », « 31.08.2026 » → « 2026-08-31 ». */
export function parseDay(value: string): DayKey | null {
  const v = value.trim();
  let key: string | null = null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const fr = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (iso) key = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (fr) key = `${fr[3]!.length === 2 ? `20${fr[3]}` : fr[3]}-${fr[2]!.padStart(2, "0")}-${fr[1]!.padStart(2, "0")}`;
  // Le jour doit exister (pas de 30 février)
  return key && isDayKey(key) && new Date(`${key}T00:00:00Z`).toISOString().startsWith(key) ? key : null;
}

/** « 1 234,5 » → 1234.5 ; null si illisible. */
export function parseDecimal(value: string): number | null {
  const v = value.replace(/\s/g, ""); // \s couvre aussi les espaces insécables
  if (!v) return null;
  // La virgule est décimale si elle est le dernier séparateur (« 1.234,5 »), sinon séparateur de milliers.
  const normalized = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
