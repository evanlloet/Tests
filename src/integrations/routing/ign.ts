import "server-only";
import type { LatLng } from "@/domain/geo";
import type { LegResult, RoadRouter } from "./types";

/**
 * Calcul d'itinéraire routier de la Géoplateforme IGN (service public, sans clé) :
 * GET {base}/itineraire?resource=bdtopo-osrm&profile=car&optimization=fastest&start=lng,lat&end=lng,lat
 * Réponse attendue : { distance, duration, distanceUnit, timeUnit, geometry }.
 *
 * Le service ne propose pas de matrice : chaque trajet est un appel (mis en cache
 * par Léa, voir server/services/travel.ts). Fonctionnement à vérifier sur
 * l'installation réelle : le bouton « Tester » du profil fait un appel témoin.
 */
export function createIgnRouter(baseUrl: string, options: { resource?: string; timeoutMs?: number; concurrency?: number } = {}): RoadRouter {
  const base = baseUrl.replace(/\/+$/, "");
  const resource = options.resource ?? "bdtopo-osrm";
  const timeoutMs = options.timeoutMs ?? 7000;
  const concurrency = options.concurrency ?? 4;
  const coord = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

  async function call(points: LatLng[], withGeometry: boolean) {
    const params = new URLSearchParams({
      resource,
      profile: "car",
      optimization: "fastest",
      start: coord(points[0]!),
      end: coord(points[points.length - 1]!),
      distanceUnit: "kilometer",
      timeUnit: "minute",
      getSteps: "false",
      getBbox: "false",
      geometryFormat: "geojson",
      crs: "EPSG:4326",
    });
    if (points.length > 2) params.set("intermediates", points.slice(1, -1).map(coord).join("|"));
    const res = await fetch(`${base}/itineraire?${params}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) throw new Error(`le service d'itinéraire IGN a répondu ${res.status}`);
    const body = (await res.json()) as { distance?: number | string; duration?: number | string; distanceUnit?: string; timeUnit?: string; geometry?: { coordinates?: [number, number][] } };
    return { leg: parseLeg(body), geometry: withGeometry ? (body.geometry?.coordinates ?? null) : null };
  }

  return {
    id: "ign",
    label: "Itinéraires routiers IGN (Géoplateforme)",
    async legs(pairs) {
      const out: (LegResult | null)[] = new Array(pairs.length).fill(null);
      let next = 0;
      let firstError: Error | null = null;
      const worker = async () => {
        while (next < pairs.length) {
          const i = next++;
          const [a, b] = pairs[i]!;
          if (a.lat === b.lat && a.lng === b.lng) {
            out[i] = { km: 0, minutes: 0 };
            continue;
          }
          try {
            out[i] = (await call([a, b], false)).leg;
          } catch (err) {
            firstError ??= err as Error;
            // Au premier échec on arrête : inutile d'insister sur un service injoignable
            next = pairs.length;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
      if (firstError && out.every((v) => v === null)) throw firstError;
      return out;
    },
    async routeGeometry(points) {
      if (points.length < 2) return null;
      return (await call(points, true)).geometry;
    },
  };
}

/** Distance (km) et durée (min) d'une réponse IGN, quelles que soient les unités renvoyées. */
export function parseLeg(body: { distance?: number | string; duration?: number | string; distanceUnit?: string; timeUnit?: string }): LegResult {
  const distance = Number(body.distance);
  const duration = Number(body.duration);
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) throw new Error("réponse d'itinéraire IGN illisible");
  const km = body.distanceUnit === "meter" ? distance / 1000 : distance;
  const minutes = body.timeUnit === "hour" ? duration * 60 : body.timeUnit === "second" ? duration / 60 : duration;
  return { km, minutes };
}
