import type { LatLng } from "../geo";

/** Matrice de trajets entre points (indices identiques à la liste de points fournie). */
export type TravelMatrix = {
  distancesKm: number[][];
  durationsMin: number[][];
};

export type TravelProviderInfo = {
  id: string;
  label: string;
  /** true seulement si les durées proviennent d'un vrai calcul d'itinéraire routier */
  isRealRouting: boolean;
  /** Mention à afficher à côté des chiffres */
  disclaimer: string | null;
};

export interface TravelProvider {
  info: TravelProviderInfo;
  matrix(points: LatLng[]): Promise<TravelMatrix>;
  /** Tracé routier (GeoJSON [lng, lat][]) ; absent si le fournisseur ne sait pas le calculer */
  routeGeometry?(points: LatLng[]): Promise<[number, number][] | null>;
}
