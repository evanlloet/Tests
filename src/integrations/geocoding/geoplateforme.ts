import "server-only";

/**
 * Géocodage via le service de la Géoplateforme IGN (ex-API Adresse / BAN).
 * Utilisé uniquement à la demande, pour les pharmacies sans coordonnées.
 * Un résultat n'est retenu que si son score est suffisant ; sinon la fiche reste
 * sans coordonnées (rien n'est deviné).
 */
export type GeocodeResult = {
  lat: number;
  lng: number;
  score: number;
  label: string;
  precision: "exact" | "street" | "city";
};

export const MIN_GEOCODE_SCORE = 0.6;

export function geocoderConfigured(): boolean {
  return Boolean(process.env.GEOCODER_URL?.trim());
}

export async function geocodeAddress(query: string, postalCode?: string | null): Promise<GeocodeResult | null> {
  const base = process.env.GEOCODER_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Aucun service de géocodage configuré (GEOCODER_URL).");
  const params = new URLSearchParams({ q: query, limit: "1", index: "address" });
  if (postalCode) params.set("postcode", postalCode);
  const res = await fetch(`${base}/search?${params}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`Le géocodeur a répondu ${res.status}`);
  const body = (await res.json()) as {
    features?: { geometry: { coordinates: [number, number] }; properties: { score: number; label: string; type: string } }[];
  };
  const f = body.features?.[0];
  if (!f || f.properties.score < MIN_GEOCODE_SCORE) return null;
  const type = f.properties.type;
  return {
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    score: f.properties.score,
    label: f.properties.label,
    precision: type === "housenumber" ? "exact" : type === "street" ? "street" : "city",
  };
}
