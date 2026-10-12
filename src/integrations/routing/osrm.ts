import "server-only";
import type { LatLng } from "@/domain/geo";
import type { TravelMatrix, TravelProvider } from "@/domain/routing/types";

/**
 * Fournisseur OSRM (Open Source Routing Machine). Nécessite un serveur OSRM
 * accessible (OSRM_URL). Le serveur de démonstration public n'est pas destiné à
 * un usage en production.
 */
export function createOsrmProvider(baseUrl: string, options: { timeoutMs?: number; profile?: string } = {}): TravelProvider {
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
    info: { id: "osrm", label: "Itinéraires routiers (OSRM)", isRealRouting: true, disclaimer: null },
    async matrix(points): Promise<TravelMatrix> {
      if (points.length < 2) return { distancesKm: [[0]], durationsMin: [[0]] };
      const body = await call<{ distances: (number | null)[][]; durations: (number | null)[][] }>(
        `/table/v1/${profile}/${coords(points)}?annotations=distance,duration`,
      );
      if (body.distances.some((row) => row.some((v) => v === null))) {
        throw new Error("OSRM n'a pas trouvé d'itinéraire pour certains points");
      }
      return {
        distancesKm: body.distances.map((row) => row.map((m) => (m ?? 0) / 1000)),
        durationsMin: body.durations.map((row) => row.map((s) => (s ?? 0) / 60)),
      };
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
