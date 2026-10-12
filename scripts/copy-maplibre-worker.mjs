// Copie le worker MapLibre dans public/ : une fois empaqueté par Next.js, MapLibre
// ne peut plus le retrouver à côté de son propre fichier.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "node_modules/maplibre-gl/package.json"), "utf8"));
const target = path.join(root, "public/vendor");
mkdirSync(target, { recursive: true });
copyFileSync(path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"), path.join(target, `maplibre-gl-worker-${pkg.version}.mjs`));
console.log(`Worker MapLibre ${pkg.version} copié dans public/vendor.`);
