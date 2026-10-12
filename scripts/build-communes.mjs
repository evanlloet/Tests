/**
 * Génère src/data/communes-ouest.json : centre approximatif et codes postaux des
 * communes des départements suivis et de leurs voisins. Sert à placer sur la carte
 * une pharmacie dont on ne connaît que le code postal et la commune (position
 * marquée « approximative : centre de la commune »).
 *
 * Sources (Licence Ouverte / Etalab) :
 *  - noms, codes INSEE, codes postaux, communes déléguées : paquet npm
 *    @etalab/decoupage-administratif (data/communes.json) ;
 *  - tracés : IGN Admin Express COG 2018, via github.com/gregoiredavid/france-geojson
 *    (departements/<dep>/communes-<dep>.geojson). Le millésime 2018, antérieur à
 *    plusieurs fusions, donne un centre plus proche du bourg pour les communes nouvelles.
 *
 * Usage : node scripts/build-communes.mjs <communes.json> <dossier des geojson>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEPARTMENTS = ["14", "22", "27", "28", "35", "44", "49", "50", "53", "56", "61", "72"];
const [cogPath, geoDir] = process.argv.slice(2);
if (!cogPath || !geoDir) {
  console.error("Usage : node scripts/build-communes.mjs <communes.json> <dossier des geojson>");
  process.exit(1);
}

/** Centre de gravité (surfacique) du plus grand polygone d'une commune. */
function centroid(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const poly of polygons) {
    const ring = poly[0];
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    if (a === 0) continue;
    const area = Math.abs(a / 2);
    if (!best || area > best.area) best = { area, lng: cx / (3 * a), lat: cy / (3 * a) };
  }
  return best && { lat: Math.round(best.lat * 1e4) / 1e4, lng: Math.round(best.lng * 1e4) / 1e4 };
}

const geo = new Map();
for (const file of readdirSync(geoDir).filter((f) => f.endsWith(".geojson"))) {
  if (!DEPARTMENTS.includes(file.match(/communes-(\d\d)/)?.[1])) continue;
  for (const f of JSON.parse(readFileSync(path.join(geoDir, file), "utf8")).features) {
    const c = centroid(f.geometry);
    if (c) geo.set(f.properties.code, { name: f.properties.nom, ...c });
  }
}

const cog = JSON.parse(readFileSync(cogPath, "utf8")).filter(
  (c) => DEPARTMENTS.includes(c.departement) && ["commune-actuelle", "commune-deleguee", "commune-associee"].includes(c.type),
);
const actuelles = new Map(cog.filter((c) => c.type === "commune-actuelle").map((c) => [c.code, c]));
const entries = new Map();
const add = (key, entry) => {
  const prev = entries.get(key);
  if (prev) {
    for (const n of entry.n) if (!prev.n.includes(n)) prev.n.push(n);
    return;
  }
  entries.set(key, entry);
};

for (const c of cog) {
  const parent = c.type === "commune-actuelle" ? c : actuelles.get(c.chefLieu);
  const cp = c.codesPostaux ?? parent?.codesPostaux ?? [];
  let pos = geo.get(c.code);
  let viaParent = false;
  if (!pos && c.type === "commune-actuelle") pos = (c.anciensCodes ?? []).map((k) => geo.get(k)).find(Boolean);
  if (!pos && parent) {
    pos = geo.get(parent.code);
    viaParent = true;
  }
  if (!pos) continue;
  const key = viaParent ? `${c.code}:${c.nom}` : c.code;
  add(key, { c: c.code, n: [c.nom], cp: [...cp], lat: pos.lat, lng: pos.lng, ...(viaParent ? { p: parent.nom } : {}) });
}
// Noms 2018 disparus depuis (fusion, changement de nom) : gardés comme alias.
for (const [code, g] of geo) {
  const entry = entries.get(code);
  if (entry) {
    if (!entry.n.includes(g.name)) entry.n.push(g.name);
    continue;
  }
  const heir = cog.find((c) => c.type === "commune-actuelle" && (c.anciensCodes ?? []).includes(code));
  if (heir) add(code, { c: code, n: [g.name], cp: [...(heir.codesPostaux ?? [])], lat: g.lat, lng: g.lng });
}

const communes = [...entries.values()].sort((a, b) => a.c.localeCompare(b.c) || a.n[0].localeCompare(b.n[0]));
writeFileSync(
  "src/data/communes-ouest.json",
  JSON.stringify({
    source:
      "INSEE / Etalab (@etalab/decoupage-administratif) pour les noms et codes postaux ; IGN Admin Express COG 2018 (france-geojson) pour les centres. Licence Ouverte.",
    departments: DEPARTMENTS,
    communes,
  }) + "\n",
);
console.log(`${communes.length} communes écrites dans src/data/communes-ouest.json`);
