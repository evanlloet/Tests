/**
 * Génère public/geo/departements-ouest.geojson : contours simplifiés des
 * départements suivis et de leurs voisins, avec un point d'étiquette. Sert de fond
 * de carte de secours (hors connexion, tuiles injoignables) et à colorer les
 * secteurs sur la carte.
 *
 * Source : IGN Admin Express (Licence Ouverte), via github.com/gregoiredavid/france-geojson
 * (departements/<dep>/departement-<dep>.geojson).
 *
 * Usage : node scripts/build-departements.mjs <dossier des geojson>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEPARTMENTS = ["14", "22", "27", "28", "35", "44", "49", "50", "53", "56", "61", "72"];
const [dir] = process.argv.slice(2);
if (!dir) {
  console.error("Usage : node scripts/build-departements.mjs <dossier des geojson>");
  process.exit(1);
}

const round = (n) => Math.round(n * 1000) / 1000; // ~100 m : suffisant pour un fond de carte

const TOLERANCE = 0.0015; // degrés (~150 m) : simplification de Douglas-Peucker

/** Distance d'un point au segment [a, b] (en degrés, approximation plane suffisante ici). */
function segmentDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function douglasPeucker(points) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let max = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(points[i], points[start], points[end]);
      if (d > max) [max, index] = [d, i];
    }
    if (max > TOLERANCE && index > 0) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplifie, arrondit et supprime les points consécutifs identiques ; ignore les anneaux dégénérés. */
function simplifyRing(ring) {
  const out = [];
  for (const [x, y] of douglasPeucker(ring)) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

function largestRingCentroid(polygons) {
  let best = null;
  for (const poly of polygons) {
    const ring = poly[0];
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f;
      cx += (ring[j][0] + ring[i][0]) * f;
      cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (a !== 0 && (!best || Math.abs(a) > best.area)) best = { area: Math.abs(a), lng: cx / (3 * a), lat: cy / (3 * a) };
  }
  return best ? [round(best.lng), round(best.lat)] : null;
}

const features = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".geojson"))) {
  const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  const f = raw.type === "FeatureCollection" ? raw.features[0] : raw;
  if (!DEPARTMENTS.includes(f.properties.code)) continue;
  const polygons = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map((poly) => poly.map(simplifyRing).filter(Boolean))
    .filter((poly) => poly.length > 0);
  features.push({
    type: "Feature",
    properties: { code: f.properties.code, nom: f.properties.nom, label: largestRingCentroid(polygons) },
    geometry: { type: "MultiPolygon", coordinates: polygons },
  });
}
features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
mkdirSync("public/geo", { recursive: true });
writeFileSync(
  "public/geo/departements-ouest.geojson",
  JSON.stringify({ type: "FeatureCollection", attribution: "IGN Admin Express (Licence Ouverte)", features }) + "\n",
);
console.log(`${features.length} départements écrits dans public/geo/departements-ouest.geojson`);
