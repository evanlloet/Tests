import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { LatLng } from "@/domain/geo";
import { createEstimateProvider, type EstimateParams } from "@/domain/routing/estimate";
import type { TravelMatrix, TravelProviderInfo } from "@/domain/routing/types";
import { reportRouting, roadRouter, routerAvailable, type LegResult } from "@/integrations/routing";
import type { DbOrTx } from "../db/client";
import { routeLegs } from "../db/schema";

export type TravelResult = {
  matrix: TravelMatrix;
  provider: TravelProviderInfo;
  geometry: [number, number][] | null;
  /** Renseigné si le moteur a échoué (ou n'a pas tout calculé) et que l'estimation a complété */
  fallbackReason: string | null;
};

/** Au-delà, les trajets restants sont estimés : une page ne doit pas attendre des dizaines d'appels. */
const MAX_NEW_LEGS = 90;
const key = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/**
 * Trajets routiers entre points, avec cache en base (table route_legs) : un trajet
 * déjà calculé n'est jamais redemandé. Si le moteur ne répond pas, l'estimation à
 * vol d'oiseau prend le relais et la raison est renvoyée pour être affichée.
 */
export async function computeTravel(db: DbOrTx, points: LatLng[], estimate: EstimateParams, withGeometry = false): Promise<TravelResult> {
  const fallback = createEstimateProvider(estimate);
  const estimated = await fallback.matrix(points);
  const router = roadRouter();
  if (!router) return { matrix: estimated, provider: fallback.info, geometry: null, fallbackReason: null };
  if (!routerAvailable()) {
    return { matrix: estimated, provider: fallback.info, geometry: null, fallbackReason: "Le moteur d'itinéraires n'a pas répondu récemment : trajets estimés." };
  }

  const keys = points.map(key);
  const cached = new Map<string, LegResult>();
  const unique = [...new Set(keys)];
  if (unique.length) {
    const rows = await db
      .select()
      .from(routeLegs)
      .where(and(eq(routeLegs.provider, router.id), inArray(routeLegs.fromKey, unique), inArray(routeLegs.toKey, unique)));
    for (const r of rows) cached.set(`${r.fromKey}>${r.toKey}`, { km: r.distanceKm, minutes: r.durationMin });
  }

  const missing: [number, number][] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = 0; j < points.length; j++) if (i !== j && keys[i] !== keys[j] && !cached.has(`${keys[i]}>${keys[j]}`)) missing.push([i, j]);
  const seen = new Set<string>();
  const toFetch = missing.filter(([i, j]) => !seen.has(`${keys[i]}>${keys[j]}`) && seen.add(`${keys[i]}>${keys[j]}`)).slice(0, MAX_NEW_LEGS);

  let fallbackReason: string | null = null;
  if (toFetch.length) {
    try {
      const legs = await router.legs(toFetch.map(([i, j]) => [points[i]!, points[j]!]));
      const fresh = toFetch
        .map(([i, j], n) => ({ i, j, leg: legs[n] }))
        .filter((x): x is { i: number; j: number; leg: LegResult } => Boolean(x.leg));
      for (const { i, j, leg } of fresh) cached.set(`${keys[i]}>${keys[j]}`, leg);
      if (fresh.length) {
        await db
          .insert(routeLegs)
          .values(fresh.map(({ i, j, leg }) => ({ provider: router.id, fromKey: keys[i]!, toKey: keys[j]!, distanceKm: leg.km, durationMin: leg.minutes })))
          .onConflictDoNothing();
      }
      reportRouting(true);
      if (fresh.length < missing.length) fallbackReason = "Certains trajets n'ont pas pu être calculés par le moteur routier : ils sont estimés.";
    } catch (err) {
      reportRouting(false, (err as Error).message);
      fallbackReason = `Le moteur d'itinéraires n'a pas répondu (${(err as Error).message}) : trajets estimés.`;
    }
  }

  const matrix: TravelMatrix = { distancesKm: estimated.distancesKm.map((r) => [...r]), durationsMin: estimated.durationsMin.map((r) => [...r]) };
  let routed = 0;
  let total = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = 0; j < points.length; j++) {
      if (i === j || keys[i] === keys[j]) continue;
      total++;
      const leg = cached.get(`${keys[i]}>${keys[j]}`);
      if (leg) {
        matrix.distancesKm[i]![j] = leg.km;
        matrix.durationsMin[i]![j] = leg.minutes;
        routed++;
      }
    }
  if (total > 0 && routed === 0) return { matrix: estimated, provider: fallback.info, geometry: null, fallbackReason };

  const geometry = withGeometry && points.length >= 2 ? await router.routeGeometry(points).catch(() => null) : null;
  return {
    matrix,
    provider: {
      id: router.id,
      label: router.label,
      isRealRouting: true,
      disclaimer: routed < total ? `${total - routed} trajet(s) sur ${total} estimé(s) à vol d'oiseau.` : null,
    },
    geometry,
    fallbackReason,
  };
}

/** Appel témoin (Rennes → Caen) pour vérifier que le moteur répond depuis ce serveur. */
export async function testRouting(): Promise<{ ok: true; label: string; km: number; minutes: number } | { ok: false; error: string }> {
  const router = roadRouter();
  if (!router) return { ok: false, error: "Aucun moteur configuré (ROUTING_PROVIDER=estimate)." };
  try {
    const [leg] = await router.legs([[{ lat: 48.1113, lng: -1.68 }, { lat: 49.1829, lng: -0.3707 }]]);
    if (!leg) throw new Error("trajet non calculé");
    reportRouting(true);
    return { ok: true, label: router.label, km: leg.km, minutes: leg.minutes };
  } catch (err) {
    reportRouting(false, (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}
