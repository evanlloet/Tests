/**
 * Rapprochement entre un événement d'agenda et le référentiel des pharmacies.
 *
 * Le score (0–1) combine :
 * - la présence des mots distinctifs du nom de la pharmacie dans le titre / lieu,
 *   pondérés par leur rareté (« Centre » ou « Gare » sont fréquents, un nom de famille l'est peu) ;
 * - la présence de la commune ou du code postal ;
 * - une tolérance aux fautes de frappe (similarité par trigrammes).
 * Chaque candidat est accompagné des raisons qui expliquent son score.
 */
import { haversineKm, type LatLng } from "./geo";
import { agendaTokens, normalizeCity, pharmacyNameTokens, setSimilarity, trigrams } from "./text";

export type MatchablePharmacy = {
  id: string;
  name: string;
  city: string | null;
  postalCode: string | null;
  addressLine: string | null;
};

export type MatchableEvent = {
  title: string;
  location: string | null;
  description?: string | null;
};

export type ScoredCandidate = { pharmacyId: string; score: number; reasons: string[] };

export type MatchDecision = {
  status: "auto_validated" | "pending" | "no_candidate";
  best: ScoredCandidate | null;
  candidates: ScoredCandidate[];
};

type IndexEntry = {
  pharmacy: MatchablePharmacy;
  nameTokens: string[];
  cityTokens: string[];
  cityPhrase: string;
  /** Jetons du nom hors commune */
  distinctive: string[];
};

/** Index pré-calculé : à construire une fois par import. */
export type MatchIndex = {
  entries: IndexEntry[];
  /** Nombre de pharmacies dont le nom contient chaque jeton */
  tokenFrequency: Map<string, number>;
  size: number;
  /** jeton distinctif → pharmacies */
  byToken: Map<string, number[]>;
  /** commune → pharmacies dont le nom se résume à la commune (« Pharmacie de Bayeux ») */
  cityOnly: Map<string, number[]>;
  /** commune → toutes ses pharmacies */
  byCity: Map<string, number[]>;
  /** Vocabulaire pour la tolérance aux fautes, regroupé par première lettre */
  fuzzyVocab: Map<string, { token: string; grams: Set<string> }[]>;
};

export function buildMatchIndex(pharmacies: MatchablePharmacy[]): MatchIndex {
  const tokenFrequency = new Map<string, number>();
  const byToken = new Map<string, number[]>();
  const cityOnly = new Map<string, number[]>();
  const byCity = new Map<string, number[]>();
  const entries = pharmacies.map((pharmacy, idx) => {
    const cityPhrase = normalizeCity(pharmacy.city);
    const cityTokens = cityPhrase ? cityPhrase.split(" ").filter((t) => t.length > 1) : [];
    // Le nom peut contenir la commune (« Pharmacie de Bayeux ») : ces jetons comptent comme commune.
    const nameTokens = [...new Set(pharmacyNameTokens(pharmacy.name))];
    const distinctive = nameTokens.filter((t) => !cityTokens.includes(t));
    for (const t of nameTokens) tokenFrequency.set(t, (tokenFrequency.get(t) ?? 0) + 1);
    for (const t of distinctive) byToken.set(t, [...(byToken.get(t) ?? []), idx]);
    if (distinctive.length === 0 && cityPhrase.length > 1) cityOnly.set(cityPhrase, [...(cityOnly.get(cityPhrase) ?? []), idx]);
    if (cityPhrase.length > 1) byCity.set(cityPhrase, [...(byCity.get(cityPhrase) ?? []), idx]);
    return { pharmacy, nameTokens, cityTokens, cityPhrase, distinctive };
  });
  const fuzzyVocab = new Map<string, { token: string; grams: Set<string> }[]>();
  for (const token of byToken.keys()) {
    if (token.length < FUZZY_MIN_LENGTH) continue;
    const bucket = fuzzyVocab.get(token[0]!) ?? [];
    bucket.push({ token, grams: trigrams(token) });
    fuzzyVocab.set(token[0]!, bucket);
  }
  return { entries, tokenFrequency, size: pharmacies.length, byToken, cityOnly, byCity, fuzzyVocab };
}

/** Poids d'un jeton : 1 pour un mot rare, plus faible pour un mot présent dans beaucoup de noms. */
function tokenWeight(index: MatchIndex, token: string): number {
  const df = index.tokenFrequency.get(token) ?? 1;
  if (index.size < 20) return df > 1 ? 0.6 : 1;
  return Math.max(0.15, Math.min(1, Math.log(index.size / df) / Math.log(index.size)) + 0.1);
}

export const FUZZY_TOKEN_THRESHOLD = 0.6;
/** Longueur minimale d'un mot du nom pour tolérer une faute de frappe */
const FUZZY_MIN_LENGTH = 5;

/**
 * Faute de frappe tolérée si les mots commencent par la même lettre, ont une
 * longueur proche et une similarité par trigrammes suffisante.
 */
function fuzzyMatch(nameToken: string, nameGrams: Set<string>, eventToken: string, eventGrams: Set<string>): number {
  if (nameToken.length < FUZZY_MIN_LENGTH || eventToken.length < 4) return 0;
  if (nameToken[0] !== eventToken[0] || Math.abs(nameToken.length - eventToken.length) > 3) return 0;
  const s = setSimilarity(nameGrams, eventGrams);
  return s >= FUZZY_TOKEN_THRESHOLD ? s : 0;
}

export function scoreCandidates(event: MatchableEvent, index: MatchIndex, options: { useDescription?: boolean } = {}): ScoredCandidate[] {
  const text = [event.title, event.location, options.useDescription ? event.description : null].filter(Boolean).join(" ");
  const tokens = agendaTokens(text);
  if (tokens.length === 0) return [];
  const tokenSet = new Set(tokens);
  const eventGrams = new Map(tokens.map((t) => [t, trigrams(t)]));
  const normalizedText = ` ${normalizeCity(text)} `;
  const postalCodes = new Set(text.match(/\b\d{5}\b/g) ?? []);

  // Présélection : pharmacies partageant un mot (exact ou proche) ou désignées par leur commune
  const candidateIdx = new Set<number>();
  for (const t of tokens) {
    for (const i of index.byToken.get(t) ?? []) candidateIdx.add(i);
    for (const v of index.fuzzyVocab.get(t[0]!) ?? []) {
      if (v.token !== t && fuzzyMatch(v.token, v.grams, t, eventGrams.get(t)!) > 0) {
        for (const i of index.byToken.get(v.token) ?? []) candidateIdx.add(i);
      }
    }
  }
  for (const [phrase, idxs] of index.cityOnly) {
    if (normalizedText.includes(` ${phrase} `)) for (const i of idxs) candidateIdx.add(i);
  }
  // « Ph. Vire » : seule la commune est indiquée → toutes les pharmacies de la commune, avec prudence
  const cityOnlyEvent = new Map<string, number>();
  for (const [phrase, idxs] of index.byCity) {
    if (!normalizedText.includes(` ${phrase} `)) continue;
    const cityTokens = new Set(phrase.split(" "));
    if (tokens.every((t) => cityTokens.has(t) || /^\d{5}$/.test(t))) {
      cityOnlyEvent.set(phrase, idxs.length);
      for (const i of idxs) candidateIdx.add(i);
    }
  }

  const out: ScoredCandidate[] = [];
  for (const i of candidateIdx) {
    const entry = index.entries[i]!;
    const { pharmacy, cityPhrase, distinctive } = entry;
    const reasons: string[] = [];

    // 1. Commune / code postal
    const cityInText = cityPhrase.length > 1 && normalizedText.includes(` ${cityPhrase} `);
    const postalInText = pharmacy.postalCode ? postalCodes.has(pharmacy.postalCode) : false;
    const cityMatch = cityInText || postalInText;
    if (cityInText) reasons.push(`Commune « ${pharmacy.city} » mentionnée`);
    else if (postalInText) reasons.push(`Code postal ${pharmacy.postalCode} mentionné`);

    // 2. Nom (hors jetons de la commune, déjà comptés)
    let score = 0;
    if (distinctive.length > 0) {
      let total = 0;
      let matched = 0;
      for (const t of distinctive) {
        const w = tokenWeight(index, t);
        total += w;
        const hit = tokenSet.has(t) ? { similarity: 1, matched: t } : bestFuzzy(t, tokens, eventGrams);
        if (hit.similarity > 0) {
          matched += w * hit.similarity;
          if (hit.similarity === 1) reasons.push(`Nom « ${t} » trouvé`);
          else reasons.push(`Nom proche : « ${hit.matched} » ≈ « ${t} » (faute de frappe probable)`);
        }
      }
      const nameScore = total > 0 ? matched / total : 0;
      if (nameScore === 0) {
        const inCity = cityOnlyEvent.get(cityPhrase);
        if (!inCity) continue;
        score = inCity === 1 ? 0.6 : 0.45;
        reasons.push(
          inCity === 1
            ? "Seule la commune est indiquée ; c'est la seule pharmacie connue dans cette commune"
            : `Seule la commune est indiquée ; ${inCity} pharmacies dans cette commune`,
        );
        out.push({ pharmacyId: pharmacy.id, score, reasons });
        continue;
      }
      const genericOnly = distinctive.every((t) => tokenWeight(index, t) < 0.5);
      if (cityMatch) {
        score = 0.7 * nameScore + 0.3;
      } else if (genericOnly) {
        score = 0.5 * nameScore;
        reasons.push("Nom courant et commune absente : plusieurs pharmacies possibles");
      } else {
        score = 0.85 * nameScore;
        reasons.push("Commune non précisée dans l'agenda");
      }
    } else if (cityMatch) {
      // « Pharmacie de Bayeux » : le nom se résume à la commune
      score = 0.75;
    } else {
      continue;
    }

    // Bonus : nom complet présent tel quel dans le texte
    const phrase = distinctive.join(" ");
    if (distinctive.length >= 2 && normalizedText.includes(` ${phrase} `)) {
      score += 0.05;
      reasons.push("Nom complet présent dans le titre");
    }
    // Indice d'adresse : rue mentionnée dans le lieu
    if (pharmacy.addressLine && event.location) {
      const street = agendaTokens(pharmacy.addressLine).filter((t) => t.length > 3 && !/^\d+$/.test(t));
      const loc = new Set(agendaTokens(event.location));
      if (street.length > 0 && street.filter((t) => loc.has(t)).length >= Math.min(2, street.length)) {
        score += 0.05;
        reasons.push("Adresse cohérente avec le lieu du rendez-vous");
      }
    }
    score = Math.min(1, Math.round(score * 1000) / 1000);
    if (score >= 0.3) out.push({ pharmacyId: pharmacy.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

function bestFuzzy(nameToken: string, tokens: string[], eventGrams: Map<string, Set<string>>) {
  const nameGrams = trigrams(nameToken);
  let best = { similarity: 0, matched: null as string | null };
  for (const t of tokens) {
    const s = fuzzyMatch(nameToken, nameGrams, t, eventGrams.get(t)!);
    if (s > best.similarity) best = { similarity: s, matched: t };
  }
  return best;
}

/** Contexte d'une journée : secteurs et lieux des autres rendez-vous déjà rattachés. */
export type DayContext = {
  departments: Map<string, number>;
  points: LatLng[];
};

export type PharmacyGeo = { departmentCode: string | null; location: LatLng | null };

/**
 * Départage par le contexte de la journée : un rendez-vous ambigu (« Pharmacie
 * Morel » sans commune) est plus probablement dans le secteur des autres visites
 * du même jour. Les ajustements sont bornés et toujours expliqués.
 */
export function applyDayContext(
  candidates: ScoredCandidate[],
  context: DayContext | undefined,
  geo: Map<string, PharmacyGeo>,
  departmentName: (code: string) => string = (c) => c,
): ScoredCandidate[] {
  if (!context || candidates.length === 0) return candidates;
  const total = [...context.departments.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return candidates;
  const [dominant, count] = [...context.departments.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const share = count / total;
  const adjusted = candidates.map((c) => {
    const g = geo.get(c.pharmacyId);
    let score = c.score;
    const reasons = [...c.reasons];
    if (g?.departmentCode && share >= 0.6) {
      if (g.departmentCode === dominant) {
        score += 0.1;
        reasons.push(`Même secteur (${departmentName(dominant)}) que ${count} autre(s) rendez-vous du jour`);
      } else if (share >= 0.8) {
        score -= 0.1;
        reasons.push(`Hors du secteur des autres rendez-vous du jour (${departmentName(dominant)})`);
      }
    }
    if (g?.location && context.points.length) {
      const nearest = Math.min(...context.points.map((p) => haversineKm(p, g.location!)));
      if (nearest <= 30) {
        score += 0.05;
        reasons.push(`À ${Math.round(nearest)} km d'un autre rendez-vous du jour`);
      }
    }
    return { ...c, score: Math.max(0, Math.min(0.97, Math.round(score * 1000) / 1000)), reasons };
  });
  return adjusted.sort((a, b) => b.score - a.score);
}

/** Le meilleur candidat est-il quasiment à égalité avec le suivant ? */
export function isAmbiguous(candidates: ScoredCandidate[]): boolean {
  const [best, second] = candidates;
  return Boolean(best && second && best.score - second.score < 0.05);
}

export const MIN_PENDING_SCORE = 0.45;
export const MIN_AUTO_GAP = 0.15;

/**
 * Décision : validation automatique seulement si le meilleur candidat est très sûr
 * ET nettement devant le suivant ; sinon validation manuelle.
 */
export function decideMatch(candidates: ScoredCandidate[], autoThreshold: number): MatchDecision {
  const [best, second] = candidates;
  if (!best || best.score < MIN_PENDING_SCORE) {
    return { status: "no_candidate", best: null, candidates };
  }
  const gap = second ? best.score - second.score : 1;
  if (best.score >= autoThreshold && gap >= MIN_AUTO_GAP) {
    return { status: "auto_validated", best, candidates };
  }
  return { status: "pending", best, candidates };
}
