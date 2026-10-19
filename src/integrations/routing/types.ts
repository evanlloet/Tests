import type { LatLng } from "@/domain/geo";

export type LegResult = { km: number; minutes: number };

/** Moteur de calcul d'itinéraires routiers (IGN, OSRM…). */
export interface RoadRouter {
  id: "ign" | "osrm";
  label: string;
  /** Trajets demandés (dans l'ordre) ; null pour un trajet non calculé */
  legs(pairs: [LatLng, LatLng][]): Promise<(LegResult | null)[]>;
  /** Tracé routier passant par les points (GeoJSON [lng, lat][]) */
  routeGeometry(points: LatLng[]): Promise<[number, number][] | null>;
}
