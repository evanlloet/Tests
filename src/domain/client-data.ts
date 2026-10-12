/**
 * Données issues du fichier clients (CA, ciblages, géolocalisation approximative).
 */

/** Évolution A / A-1 (0.25 = +25 %) ; null si A-1 est absent ou nul. */
export function revenueEvolution(previous: number | string | null | undefined, current: number | string | null | undefined): number | null {
  const p = previous === null || previous === undefined ? NaN : Number(previous);
  const c = current === null || current === undefined ? NaN : Number(current);
  if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
  return (c - p) / p;
}

/** Libellé lisible de la géolocalisation d'une fiche. */
export function geoLabel(p: { lat: number | null; geoPrecision: string | null; geoSource: string | null }): string {
  if (p.lat === null) return "Non géolocalisée";
  if (p.geoSource?.startsWith("centre_commune")) {
    const [, basis, name] = p.geoSource.split(":");
    return `Approximative : centre de la ${basis === "commune-nouvelle" ? "commune nouvelle" : "commune"}${name ? ` (${name})` : ""}`;
  }
  const precision = { exact: "précise", street: "à la rue", city: "à la commune", unknown: "inconnue" }[p.geoPrecision ?? "unknown"] ?? "inconnue";
  return `Position ${precision}${p.geoSource ? ` — ${p.geoSource}` : ""}`;
}

/** Position connue seulement à la commune (centre de la commune). */
export const isApproximate = (p: { lat: number | null; geoPrecision: string | null }) => p.lat !== null && p.geoPrecision === "city";
