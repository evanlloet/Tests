/**
 * Écrit les fichiers de TEST fictifs (pharmacies CSV + agenda ICS) dans un dossier.
 * Usage : npx tsx scripts/generate-test-files.ts <dossier>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { demoIcs, demoPharmacyCsv } from "../tests/fixtures/demo-data";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage : npx tsx scripts/generate-test-files.ts <dossier>");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "test-pharmacies.csv"), demoPharmacyCsv());
writeFileSync(path.join(dir, "test-agenda.ics"), demoIcs(new Date()));
console.log(`Fichiers de test écrits dans ${dir}`);
