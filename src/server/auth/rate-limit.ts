import "server-only";

/**
 * Limitation des tentatives de connexion (mémoire du processus).
 * Suffisant pour une instance unique ; à remplacer par un stockage partagé
 * (table PostgreSQL ou Redis) en cas de déploiement multi-instances.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; first: number }>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else entry.count++;
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
