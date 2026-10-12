/**
 * Estimation sans moteur de routage : distance à vol d'oiseau × coefficient de
 * détour ; vitesse moyenne croissante avec la distance (45 km/h en ville, jusqu'à
 * `speedKmh` au-delà de 100 km, pour tenir compte des voies rapides).
 * Ce n'est PAS un calcul d'itinéraire : l'interface l'affiche toujours comme une estimation.
 */
import { haversineKm, type LatLng } from "../geo";
import type { TravelMatrix, TravelProvider } from "./types";

export type EstimateParams = { roadFactor: number; speedKmh: number };

export const DEFAULT_ESTIMATE: EstimateParams = { roadFactor: 1.25, speedKmh: 90 };

export const SHORT_TRIP_SPEED_KMH = 45;

export function estimatedSpeedKmh(km: number, longDistanceSpeed: number): number {
  const top = Math.max(SHORT_TRIP_SPEED_KMH, longDistanceSpeed);
  return SHORT_TRIP_SPEED_KMH + (top - SHORT_TRIP_SPEED_KMH) * Math.min(1, km / 100);
}

export function estimateLeg(a: LatLng, b: LatLng, params: EstimateParams = DEFAULT_ESTIMATE) {
  const km = haversineKm(a, b) * params.roadFactor;
  return { km, minutes: km === 0 ? 0 : (km / estimatedSpeedKmh(km, params.speedKmh)) * 60 };
}

export function estimateMatrix(points: LatLng[], params: EstimateParams = DEFAULT_ESTIMATE): TravelMatrix {
  const n = points.length;
  const distancesKm = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const durationsMin = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { km, minutes } = estimateLeg(points[i]!, points[j]!, params);
      distancesKm[i]![j] = distancesKm[j]![i] = km;
      durationsMin[i]![j] = durationsMin[j]![i] = minutes;
    }
  }
  return { distancesKm, durationsMin };
}

export function createEstimateProvider(params: EstimateParams = DEFAULT_ESTIMATE): TravelProvider {
  return {
    info: {
      id: "estimate",
      label: "Estimation à vol d'oiseau",
      isRealRouting: false,
      disclaimer: `Aucun moteur de routage connecté : distances à vol d'oiseau × ${params.roadFactor.toLocaleString("fr-FR")}, vitesse moyenne de ${SHORT_TRIP_SPEED_KMH} à ${params.speedKmh} km/h selon la distance. Chiffres indicatifs, pas un calcul d'itinéraire.`,
    },
    async matrix(points) {
      return estimateMatrix(points, params);
    },
  };
}
