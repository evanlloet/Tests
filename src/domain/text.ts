/**
 * Normalisation de texte pour la recherche, le dédoublonnage et le rapprochement.
 */

/** Minuscules, sans accents, ponctuation remplacée par des espaces. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mots sans valeur distinctive dans un nom de pharmacie. */
const PHARMACY_STOPWORDS = new Set([
  "pharmacie",
  "pharmacies",
  "pharma",
  "pharm",
  "ph",
  "officine",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "l",
  "d",
  "et",
  "a",
  "au",
  "aux",
  "en",
  "sur",
  "sous",
  "sarl",
  "selarl",
  "selas",
  "snc",
  "eurl",
  "sas",
  "sa",
  "scp",
]);

/** Mots fréquents dans les titres d'agenda qui ne désignent pas une pharmacie. */
const AGENDA_NOISE = new Set([
  "rdv",
  "rendez",
  "vous",
  "visite",
  "visites",
  "passage",
  "annule",
  "annulee",
  "annulation",
  "canceled",
  "cancelled",
  "reporte",
  "confirme",
  "tel",
  "telephone",
  "chez",
  "avec",
  "mme",
  "mr",
  "m",
  "dr",
  "docteur",
  "pour",
  "rv",
  "france",
]);

export function tokenize(input: string | null | undefined): string[] {
  const n = normalizeText(input);
  return n ? n.split(" ") : [];
}

/** Jetons distinctifs d'un nom de pharmacie (sans « pharmacie », articles, formes juridiques). */
export function pharmacyNameTokens(name: string): string[] {
  return tokenize(name).filter((t) => !PHARMACY_STOPWORDS.has(t) && t.length > 1);
}

/** Jetons utiles d'un titre / lieu de rendez-vous. */
export function agendaTokens(input: string): string[] {
  return tokenize(input).filter((t) => !PHARMACY_STOPWORDS.has(t) && !AGENDA_NOISE.has(t) && t.length > 1);
}

/** Nom normalisé utilisé pour la recherche et le dédoublonnage. */
export function normalizePharmacyName(name: string): string {
  return pharmacyNameTokens(name).join(" ") || normalizeText(name);
}

/** Commune normalisée : « Saint-Lô » → « saint lo », « St Lô » → « saint lo ». */
export function normalizeCity(city: string | null | undefined): string {
  return normalizeText(city)
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint")
    .replace(/\bcedex\b.*$/, "")
    .trim();
}

/** Clé de dédoublonnage d'une pharmacie : nom normalisé | code postal | commune. */
export function pharmacyDedupeKey(name: string, postalCode: string | null | undefined, city: string | null | undefined) {
  return [normalizePharmacyName(name), (postalCode ?? "").replace(/\s/g, ""), normalizeCity(city)].join("|");
}

/** Similarité par trigrammes (0–1), tolérante aux fautes de frappe. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}
