import "server-only";
import type { LatLng } from "@/domain/geo";
import type { LegResult, RoadRouter } from "./types";

/**
 * Fournisseur OSRM (Open Source Routing Machine). Nécessite un serveur OSRM
 * accessible (OSRM_URL). Le serveur de démonstration public n'est pas destiné à
 * un usage intensif ; un serveur dédié (ou l'IGN) est préférable.
 */
export function createOsrmRouter(baseUrl: string, options: { timeoutMs?: number; profile?: string } = {}): RoadRouter {
  const base = baseUrl.replace(/\/+$/, "");
  const profile = options.profile ?? "driving";
  const timeoutMs = options.timeoutMs ?? 8000;
  const coords = (points: LatLng[]) => points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

  async function call<T>(path: string): Promise<T> {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) throw new Error(`OSRM a répondu ${res.status}`);
    const body = (await res.json()) as T & { code?: string; message?: string };
    if (body.code && body.code !== "Ok") throw new Error(`OSRM : ${body.message ?? body.code}`);
    return body;
  }

  return {
    id: "osrm",
    label: "Itinéraires routiers (OSRM)",
    async legs(pairs) {
      if (pairs.length === 0) return [];
      // Une seule requête « table » pour tous les points distincts
      const keyOf = (p: LatLng) => `${p.lat},${p.lng}`;
      const unique = new Map<string, LatLng>();
      for (const [a, b] of pairs) {
        unique.set(keyOf(a), a);
        unique.set(keyOf(b), b);
      }
      const points = [...unique.values()];
      const index = new Map(points.map((p, i) => [keyOf(p), i]));
      const body = await call<{ distances: (number | null)[][]; durations: (number | null)[][] }>(
        `/table/v1/${profile}/${coords(points)}?annotations=distance,duration`,
      );
      return pairs.map(([a, b]): LegResult | null => {
        const i = index.get(keyOf(a))!;
        const j = index.get(keyOf(b))!;
        const m = body.distances[i]?.[j];
        const s = body.durations[i]?.[j];
        return m == null || s == null ? null : { km: m / 1000, minutes: s / 60 };
      });
    },
    async routeGeometry(points) {
      if (points.length < 2) return null;
      const body = await call<{ routes: { geometry: { coordinates: [number, number][] } }[] }>(
        `/route/v1/${profile}/${coords(points)}?overview=full&geometries=geojson`,
      );
      return body.routes[0]?.geometry.coordinates ?? null;
    },
  };
}
