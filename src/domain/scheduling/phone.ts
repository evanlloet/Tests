/**
 * Rendez-vous téléphoniques. L'agenda ne les distingue pas des visites : on les
 * déduit de la géographie de la journée, puis l'utilisatrice valide.
 *
 *  - « certain » :
 *     · pris pendant un créneau de télétravail (« VCA / TAD ») ;
 *     · impossible d'y être physiquement : entre deux rendez-vous consécutifs, le
 *       trajet dépasse nettement le temps disponible (écart + visite écourtée à
 *       20 min + 30 min de marge). Des deux, on retient celui qui est le plus loin
 *       du cœur de la journée, puis on recommence.
 *  - « probable » : rendez-vous isolé (> 60 km de toutes les autres visites du
 *    jour), ou rendez-vous court (≤ 30 min) éloigné (> 35 km), ou sans durée.
 *
 * Une visite isolée mais placée sur la route du départ ou du retour (détour < 25 km)
 * reste une vraie visite : « Périers en rentrant de Cherbourg ».
 */
import { haversineKm, type LatLng } from "../geo";
import { DEFAULT_ESTIMATE, estimateLeg, type EstimateParams } from "../routing/estimate";

export type PhoneVisitInput = {
  id: string;
  start: Date;
  end: Date;
  /** Même pharmacie ⇒ jamais comparée à elle-même (visite en deux temps) */
  pharmacyKey: string;
  /** Libellé du lieu pour les explications (commune) */
  place: string;
  location: LatLng | null;
};

export type PhoneDayInput = {
  visits: PhoneVisitInput[];
  teleworkBlocks: { start: Date; end: Date }[];
  /** Point de départ (domicile ou hôtel de la veille) et d'arrivée (domicile ou hôtel du soir) */
  dayStart: LatLng | null;
  dayEnd: LatLng | null;
};

export type PhoneDetection = { level: "certain" | "probable"; reason: string };

const MIN = 60_000;

export function detectPhoneVisits(day: PhoneDayInput, estimate: EstimateParams = DEFAULT_ESTIMATE): Map<string, PhoneDetection> {
  const out = new Map<string, PhoneDetection>();
  const km = (a: LatLng, b: LatLng) => estimateLeg(a, b, estimate).km;
  const minutes = (a: LatLng, b: LatLng) => estimateLeg(a, b, estimate).minutes;

  for (const v of day.visits) {
    if (day.teleworkBlocks.some((b) => b.start.getTime() <= v.start.getTime() + MIN && b.end.getTime() >= v.end.getTime() - MIN)) {
      out.set(v.id, { level: "certain", reason: "Pris pendant le télétravail" });
    } else if (v.end.getTime() - v.start.getTime() < MIN) {
      out.set(v.id, { level: "probable", reason: "Rendez-vous sans durée" });
    }
  }

  const kept = day.visits.filter((v) => v.location && !out.has(v.id));
  const duration = (v: PhoneVisitInput) => (v.end.getTime() - v.start.getTime()) / MIN;

  // 1. Trajets impossibles
  for (let guard = 0; guard < day.visits.length; guard++) {
    const core = medoid(kept.map((v) => v.location!));
    const ordered = [...kept].sort((a, b) => a.start.getTime() - b.start.getTime());
    let worst: { a: PhoneVisitInput; b: PhoneVisitInput; excess: number } | null = null;
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!;
      const b = ordered[i]!;
      if (a.pharmacyKey === b.pharmacyKey || km(a.location!, b.location!) <= 30) continue;
      const available = (b.start.getTime() - a.end.getTime()) / MIN + Math.max(0, duration(a) - 20);
      const excess = minutes(a.location!, b.location!) - available;
      if (excess > 30 && (!worst || excess > worst.excess)) worst = { a, b, excess };
    }
    if (!worst || !core) break;
    const aFar = haversineKm(worst.a.location!, core) >= haversineKm(worst.b.location!, core);
    const [far, near] = aFar ? [worst.a, worst.b] : [worst.b, worst.a];
    out.set(far.id, { level: "certain", reason: `${Math.round(km(far.location!, near.location!))} km de ${near.place}, sans le temps de faire la route` });
    kept.splice(kept.indexOf(far), 1);
  }

  // 2. Rendez-vous isolés
  const ordered = [...kept].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const [i, v] of ordered.entries()) {
    const others = ordered.filter((o) => o !== v && o.pharmacyKey !== v.pharmacyKey);
    if (others.length < 2) continue;
    const nearest = Math.min(...others.map((o) => km(v.location!, o.location!)));
    if (nearest <= 35) continue;
    const onTheWay = (() => {
      if (i !== 0 && i !== ordered.length - 1) return false;
      const prev = i === 0 ? day.dayStart : ordered[i - 1]!.location;
      const next = i === ordered.length - 1 ? day.dayEnd : ordered[i + 1]!.location;
      if (!prev || !next) return false;
      return km(prev, v.location!) + km(v.location!, next) - km(prev, next) < 25;
    })();
    if (onTheWay) continue;
    if (nearest > 60) out.set(v.id, { level: "probable", reason: `Isolé : ${Math.round(nearest)} km de la visite la plus proche du jour` });
    else if (duration(v) <= 30) out.set(v.id, { level: "probable", reason: `30 min, à ${Math.round(nearest)} km des autres visites` });
  }
  return out;
}

/** Point le plus central (somme des distances minimale). */
function medoid(points: LatLng[]): LatLng | null {
  let best: LatLng | null = null;
  let bestSum = Infinity;
  for (const p of points) {
    const s = points.reduce((n, q) => n + haversineKm(p, q), 0);
    if (s < bestSum) {
      bestSum = s;
      best = p;
    }
  }
  return best;
}
