import "server-only";
import { createIgnRouter } from "./ign";
import { createOsrmRouter } from "./osrm";
import type { RoadRouter } from "./types";

export type { LegResult, RoadRouter } from "./types";

/**
 * Choix du moteur d'itinéraires routiers (variable ROUTING_PROVIDER) :
 *  - « ign » (par défaut) : Géoplateforme IGN, service public sans clé ;
 *  - « osrm » : serveur OSRM (OSRM_URL) ;
 *  - « estimate » : aucun appel, estimation à vol d'oiseau clairement signalée.
 */
export function roadRouter(): RoadRouter | null {
  const choice = (process.env.ROUTING_PROVIDER?.trim().toLowerCase() || (process.env.OSRM_URL?.trim() ? "osrm" : "ign")) as string;
  if (choice === "estimate" || choice === "none") return null;
  if (choice === "osrm") {
    const url = process.env.OSRM_URL?.trim();
    return url ? createOsrmRouter(url) : null;
  }
  return createIgnRouter(process.env.IGN_ROUTING_URL?.trim() || "https://data.geopf.fr/navigation");
}

/**
 * État du moteur pour cette instance du serveur. Après un échec, on n'insiste pas
 * pendant quelques minutes : l'estimation prend le relais immédiatement (et
 * l'interface le signale) au lieu de faire attendre chaque page.
 */
const health: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string | null } = {
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
};
const RETRY_AFTER_MS = 5 * 60_000;

export function routerAvailable(now = Date.now()): boolean {
  return !health.lastFailureAt || now - health.lastFailureAt.getTime() > RETRY_AFTER_MS;
}

export function reportRouting(ok: boolean, error?: string) {
  if (ok) {
    health.lastSuccessAt = new Date();
    health.lastFailureAt = null;
    health.lastError = null;
  } else {
    health.lastFailureAt = new Date();
    health.lastError = error ?? "erreur inconnue";
  }
}

export function routingStatus(): { configured: boolean; label: string; lastSuccessAt: Date | null; lastError: string | null; paused: boolean } {
  const router = roadRouter();
  return {
    configured: Boolean(router),
    label: router ? router.label : "Aucun : estimation à vol d'oiseau",
    lastSuccessAt: health.lastSuccessAt,
    lastError: health.lastError,
    paused: !routerAvailable(),
  };
}

