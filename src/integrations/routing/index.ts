import "server-only";
import { createIgnRouter } from "./ign";
import { createOsrmRouter } from "./osrm";
import type { RoadRouter } from "./types";
import type { LatLng } from "@/domain/geo";
import { createEstimateProvider, type EstimateParams } from "@/domain/routing/estimate";
import type { TravelMatrix, TravelProviderInfo } from "@/domain/routing/types";

export type { LegResult, RoadRouter } from "./types";

/**
 * Choix du moteur d'itinéraires routiers (variable ROUTING_PROVIDER) :
 *  - « ign » (par défaut) : Géoplateforme IGN, service public sans clé ;
 *  - « osrm » : serveur OSRM (OSRM_URL) ;
 *  - « estimate » : aucun appel, estimation à vol d'oiseau clairement signalée.
 */
export function roadRouter(): RoadRouter | null {
  const choice = (process.env.ROUTING_PROVIDER?.trim().toLowerCase() || (process.env.OSRM_URL?.trim() ? "osrm" : "ign")) as string;
  if (choice === "estimate" || choice === "none") return null;
  if (choice === "osrm") {
    const url = process.env.OSRM_URL?.trim();
    return url ? createOsrmRouter(url) : null;
  }
  return createIgnRouter(process.env.IGN_ROUTING_URL?.trim() || "https://data.geopf.fr/navigation");
}

/**
 * État du moteur pour cette instance du serveur. Après un échec, on n'insiste pas
 * pendant quelques minutes : l'estimation prend le relais immédiatement (et
 * l'interface le signale) au lieu de faire attendre chaque page.
 */
const health: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string | null } = {
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
};
const RETRY_AFTER_MS = 5 * 60_000;

export function routerAvailable(now = Date.now()): boolean {
  return !health.lastFailureAt || now - health.lastFailureAt.getTime() > RETRY_AFTER_MS;
}

export function reportRouting(ok: boolean, error?: string) {
  if (ok) {
    health.lastSuccessAt = new Date();
    health.lastFailureAt = null;
    health.lastError = null;
  } else {
    health.lastFailureAt = new Date();
    health.lastError = error ?? "erreur inconnue";
  }
}

export function routingStatus(): { configured: boolean; label: string; lastSuccessAt: Date | null; lastError: string | null; paused: boolean } {
  const router = roadRouter();
  return {
    configured: Boolean(router),
    label: router ? router.label : "Aucun : estimation à vol d'oiseau",
    lastSuccessAt: health.lastSuccessAt,
    lastError: health.lastError,
    paused: !routerAvailable(),
  };
}

export type MatrixResult = {
  matrix: TravelMatrix;
  provider: TravelProviderInfo;
  geometry: [number, number][] | null;
  /** Renseigné si le moteur configuré a échoué et que l'estimation a pris le relais */
  fallbackReason: string | null;
};

/**
 * Matrice de trajets entre points : moteur routier s'il répond, sinon estimation à
 * vol d'oiseau (toujours présentée comme telle). Un trajet non calculé par le moteur
 * est complété par l'estimation.
 */
export async function computeTravel(points: LatLng[], estimate: EstimateParams, withGeometry = false): Promise<MatrixResult> {
  const fallback = createEstimateProvider(estimate);
  const estimated = await fallback.matrix(points);
  const router = roadRouter();
  if (!router || !routerAvailable()) {
    return { matrix: estimated, provider: fallback.info, geometry: null, fallbackReason: router ? "Le moteur d'itinéraires est momentanément indisponible." : null };
  }
  try {
    const pairs: [LatLng, LatLng][] = [];
    for (const a of points) for (const b of points) pairs.push([a, b]);
    const legs = await router.legs(pairs);
    const matrix: TravelMatrix = { distancesKm: estimated.distancesKm.map((r) => [...r]), durationsMin: estimated.durationsMin.map((r) => [...r]) };
    legs.forEach((leg, k) => {
      if (!leg) return;
      const i = Math.floor(k / points.length);
      const j = k % points.length;
      matrix.distancesKm[i]![j] = leg.km;
      matrix.durationsMin[i]![j] = leg.minutes;
    });
    reportRouting(true);
    const geometry = withGeometry ? await router.routeGeometry(points).catch(() => null) : null;
    return { matrix, provider: { id: router.id, label: router.label, isRealRouting: true, disclaimer: null }, geometry, fallbackReason: null };
  } catch (err) {
    reportRouting(false, (err as Error).message);
    return { matrix: estimated, provider: fallback.info, geometry: null, fallbackReason: `Le moteur d'itinéraires n'a pas répondu (${(err as Error).message}).` };
  }
}
