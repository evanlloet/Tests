import "server-only";
import type { LatLng } from "@/domain/geo";
import { createEstimateProvider, type EstimateParams } from "@/domain/routing/estimate";
import type { TravelMatrix, TravelProviderInfo } from "@/domain/routing/types";
import { createOsrmProvider } from "./osrm";

export type MatrixResult = {
  matrix: TravelMatrix;
  provider: TravelProviderInfo;
  geometry: [number, number][] | null;
  /** Renseigné si le moteur configuré a échoué et que l'estimation a pris le relais */
  fallbackReason: string | null;
};

/**
 * Point d'entrée unique du routage : le CRM ne dépend d'aucun fournisseur précis.
 * - OSRM si OSRM_URL est défini et répond ;
 * - sinon estimation à vol d'oiseau, toujours présentée comme telle.
 */
export async function computeTravel(points: LatLng[], estimate: EstimateParams, withGeometry = false): Promise<MatrixResult> {
  const fallback = createEstimateProvider(estimate);
  const osrmUrl = process.env.OSRM_URL?.trim();
  if (osrmUrl) {
    const osrm = createOsrmProvider(osrmUrl);
    try {
      const matrix = await osrm.matrix(points);
      let geometry: [number, number][] | null = null;
      if (withGeometry) geometry = await osrm.routeGeometry!(points).catch(() => null);
      return { matrix, provider: osrm.info, geometry, fallbackReason: null };
    } catch (err) {
      return {
        matrix: await fallback.matrix(points),
        provider: fallback.info,
        geometry: null,
        fallbackReason: `Le moteur de routage configuré n'a pas répondu (${(err as Error).message}).`,
      };
    }
  }
  return { matrix: await fallback.matrix(points), provider: fallback.info, geometry: null, fallbackReason: null };
}

export function routingStatus(): { configured: boolean; label: string } {
  const url = process.env.OSRM_URL?.trim();
  return url ? { configured: true, label: `OSRM (${new URL(url).host})` } : { configured: false, label: "Aucun — estimation à vol d'oiseau" };
}
