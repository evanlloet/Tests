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
import { agendaTokens, normalizeCity, pharmacyNameTokens, trigramSimilarity } from "./text";

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

/** Index pré-calculé : à construire une fois par import. */
export type MatchIndex = {
  entries: {
    pharmacy: MatchablePharmacy;
    nameTokens: string[];
    cityTokens: string[];
    cityPhrase: string;
  }[];
  /** Nombre de pharmacies dont le nom contient chaque jeton */
  tokenFrequency: Map<string, number>;
  size: number;
};

export function buildMatchIndex(pharmacies: MatchablePharmacy[]): MatchIndex {
  const tokenFrequency = new Map<string, number>();
  const entries = pharmacies.map((pharmacy) => {
    const cityPhrase = normalizeCity(pharmacy.city);
    const cityTokens = cityPhrase ? cityPhrase.split(" ").filter((t) => t.length > 1) : [];
    // Le nom peut contenir la commune (« Pharmacie de Bayeux ») : ces jetons comptent comme commune.
    const nameTokens = [...new Set(pharmacyNameTokens(pharmacy.name))];
    for (const t of nameTokens) tokenFrequency.set(t, (tokenFrequency.get(t) ?? 0) + 1);
    return { pharmacy, nameTokens, cityTokens, cityPhrase };
  });
  return { entries, tokenFrequency, size: pharmacies.length };
}

/** Poids d'un jeton : 1 pour un mot rare, plus faible pour un mot présent dans beaucoup de noms. */
function tokenWeight(index: MatchIndex, token: string): number {
  const df = index.tokenFrequency.get(token) ?? 1;
  if (index.size < 20) return df > 1 ? 0.6 : 1;
  return Math.max(0.15, Math.min(1, Math.log(index.size / df) / Math.log(index.size)) + 0.1);
}

export const FUZZY_TOKEN_THRESHOLD = 0.6;

function bestTokenMatch(token: string, haystack: string[]): { similarity: number; matched: string | null } {
  let best = { similarity: 0, matched: null as string | null };
  for (const h of haystack) {
    if (h === token) return { similarity: 1, matched: h };
    if (token.length >= 5 && h.length >= 4) {
      const s = trigramSimilarity(token, h);
      if (s > best.similarity) best = { similarity: s, matched: h };
    }
  }
  return best.similarity >= FUZZY_TOKEN_THRESHOLD ? best : { similarity: 0, matched: null };
}

export function scoreCandidates(event: MatchableEvent, index: MatchIndex, options: { useDescription?: boolean } = {}): ScoredCandidate[] {
  const text = [event.title, event.location, options.useDescription ? event.description : null].filter(Boolean).join(" ");
  const tokens = agendaTokens(text);
  if (tokens.length === 0) return [];
  const tokenSet = new Set(tokens);
  const normalizedText = ` ${normalizeCity(text)} `;
  const postalCodes = new Set(text.match(/\b\d{5}\b/g) ?? []);

  const out: ScoredCandidate[] = [];
  for (const entry of index.entries) {
    const { pharmacy, nameTokens, cityTokens, cityPhrase } = entry;
    const reasons: string[] = [];

    // 1. Commune / code postal
    const cityInText = cityPhrase.length > 1 && normalizedText.includes(` ${cityPhrase} `);
    const postalInText = pharmacy.postalCode ? postalCodes.has(pharmacy.postalCode) : false;
    const cityMatch = cityInText || postalInText;
    if (cityInText) reasons.push(`Commune « ${pharmacy.city} » mentionnée`);
    else if (postalInText) reasons.push(`Code postal ${pharmacy.postalCode} mentionné`);

    // 2. Nom (hors jetons de la commune, déjà comptés)
    const distinctive = nameTokens.filter((t) => !cityTokens.includes(t));
    let score = 0;
    if (distinctive.length > 0) {
      let total = 0;
      let matched = 0;
      for (const t of distinctive) {
        const w = tokenWeight(index, t);
        total += w;
        const hit = tokenSet.has(t) ? { similarity: 1, matched: t } : bestTokenMatch(t, tokens);
        if (hit.similarity > 0) {
          matched += w * hit.similarity;
          if (hit.similarity === 1) reasons.push(`Nom « ${t} » trouvé`);
          else reasons.push(`Nom proche : « ${hit.matched} » ≈ « ${t} » (faute de frappe probable)`);
        }
      }
      const nameScore = total > 0 ? matched / total : 0;
      if (nameScore === 0) continue;
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
