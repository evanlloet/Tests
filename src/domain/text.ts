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
  "sasu",
  "sa",
  "scp",
  "spfpl",
  "selafa",
  "selca",
  "phie",
  "phcie",
  "pcie",
  "mme",
  "madame",
  "monsieur",
]);

/** Abréviations courantes des noms de pharmacie et des titres d'agenda. */
const ABBREVIATIONS: Record<string, string[]> = {
  gde: ["grande"],
  gd: ["grand"],
  st: ["saint"],
  ste: ["sainte"],
  ccal: ["centre", "commercial"],
  ccial: ["centre", "commercial"],
  cial: ["commercial"],
};

function expand(tokens: string[]): string[] {
  return tokens.flatMap((t) => ABBREVIATIONS[t] ?? [t]);
}

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
  return expand(tokenize(name)).filter((t) => !PHARMACY_STOPWORDS.has(t) && t.length > 1);
}

/** Jetons utiles d'un titre / lieu de rendez-vous. */
export function agendaTokens(input: string): string[] {
  return expand(tokenize(input)).filter((t) => !PHARMACY_STOPWORDS.has(t) && !AGENDA_NOISE.has(t) && t.length > 1);
}

const LEGAL_FORMS = new Set(["selarl", "selas", "selafa", "selca", "sel", "sarl", "sas", "sasu", "sa", "snc", "eurl", "scp", "spfpl"]);
const SMALL_WORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "sur", "sous", "en", "au", "aux", "a"]);
const NAME_ABBREVIATIONS: Record<string, string> = {
  phie: "Pharmacie",
  phcie: "Pharmacie",
  pcie: "Pharmacie",
  gde: "Grande",
  gd: "Grand",
  ccal: "Centre Commercial",
  ccial: "Centre Commercial",
  st: "Saint",
  mme: "Mme",
};

/**
 * Nom lisible à partir d'une raison sociale en capitales :
 * « SELARL GRANDE PHIE DU PHARE » → « Grande Pharmacie du Phare ».
 * La forme juridique de tête est retirée ; un nom déjà en minuscules n'est pas réécrit.
 */
export function readablePharmacyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  let words = name.split(" ");
  while (words.length > 1 && LEGAL_FORMS.has(normalizeText(words[0]))) words = words.slice(1);
  const letters = words.join("").replace(/[^A-Za-zÀ-ÿ]/g, "");
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, "").length;
  if (!letters || upper / letters.length < 0.8) return words.join(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const n = normalizeText(w);
    const next = normalizeText(words[i + 1] ?? "");
    if ((n === "l" || n === "d") && next && i < words.length - 1) {
      // « L AVRANCHIN » → « l'Avranchin »
      const joined = `${i === 0 ? n.toUpperCase() : n}'${titleWord(words[i + 1]!)}`;
      out.push(joined);
      i++;
      continue;
    }
    const person = out[0] === "Mme" || out[0] === "M.";
    if (n === "c" && next === "cial") {
      out.push("Centre Commercial");
      i++;
    } else if (n === "ste" && !["de", "d", "du", "des"].includes(next)) out.push("Sainte");
    else if (n === "m" && i === 0 && words.length > 1) out.push("M.");
    else if (NAME_ABBREVIATIONS[n]) out.push(NAME_ABBREVIATIONS[n]);
    // « PHIE LE SAINT » → « Pharmacie Le Saint » (nom propre) ; « PHIE DE LA POSTE » → « Pharmacie de la Poste »
    else if (i > 0 && SMALL_WORDS.has(n) && !person && !(out[out.length - 1] === "Pharmacie" && ["le", "la", "les"].includes(n))) out.push(n);
    else out.push(titleWord(w));
  }
  return out.join(" ");
}

function titleWord(w: string): string {
  if (/\d/.test(w) || !/[AEIOUYÀ-ÖØ-Ýaeiouy]/i.test(w)) return w; // « FRA000 », « BCD »
  return w
    .toLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
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
  return setSimilarity(trigrams(a), trigrams(b));
}

/** Indice de Jaccard entre deux ensembles de trigrammes pré-calculés. */
export function setSimilarity(ta: Set<string>, tb: Set<string>): number {
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}
