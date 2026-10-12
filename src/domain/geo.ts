export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371.0088;

/** Distance orthodromique (« à vol d'oiseau ») en kilomètres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export function hasLocation<T extends { lat: number | null; lng: number | null }>(
  p: T,
): p is T & { lat: number; lng: number } {
  return isValidLatLng(p.lat, p.lng);
}

/** Emprise métropolitaine approximative : sert à détecter des coordonnées inversées ou aberrantes. */
export function isInMetropolitanFrance(p: LatLng): boolean {
  return p.lat >= 41 && p.lat <= 51.5 && p.lng >= -5.5 && p.lng <= 10;
}
