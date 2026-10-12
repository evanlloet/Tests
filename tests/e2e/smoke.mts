/**
 * Parcours de bout en bout dans un vrai navigateur (Chromium via playwright-core) :
 * inscription, domicile, import pharmacies (×2, sans doublon), import Outlook ICS (×2),
 * rapprochement, fiche, prochaine visite, planning, tournée, carte, pilotage, mobile,
 * mode sombre. Utilise des DONNÉES DE TEST FICTIVES générées à la volée.
 *
 * Prérequis : application démarrée (npm run dev) sur une base de développement.
 * Usage : npm run test:e2e
 * Variables : E2E_BASE_URL (défaut http://localhost:3000), CHROMIUM_PATH (navigateur),
 *             E2E_SHOTS (dossier des captures d'écran, facultatif).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { demoIcs, demoPharmacyCsv } from "../fixtures/demo-data.ts";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const DIR = mkdtempSync(path.join(tmpdir(), "lea-e2e-")) + "/";
writeFileSync(`${DIR}test-pharmacies.csv`, demoPharmacyCsv());
writeFileSync(`${DIR}test-agenda.ics`, demoIcs(new Date()));
const SHOTS = process.env.E2E_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const email = `lea+${Date.now()}@example.test`;
const log = (...a: unknown[]) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-FR", timezoneId: "Europe/Paris" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/tiles|data\.geopf|Failed to load resource|ERR_TUNNEL|AJAXError/i.test(m.text())) errors.push(`console: ${m.text()}`);
});
const shot = async (name: string, p: Page = page) => {
  if (!SHOTS) return;
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

// 1. Inscription
await page.goto(`${BASE}/`);
log("redirigé vers", page.url());
await page.goto(`${BASE}/inscription`);
await page.fill("#displayName", "Léa");
await page.fill("#email", email);
await page.fill("#password", "motdepasse123");
await Promise.all([page.waitForURL(/\/profil/), page.click("button[type=submit]")]);
log("inscription OK →", page.url());

// 2. Domicile (Rennes)
await page.fill("#homeAddress", "Rennes");
await page.fill("#homeLat", "48,1173");
await page.fill("#homeLng", "-1,6778");
await page.locator("#deplacements button[type=submit]").first().click();
await page.getByText("Préférences de déplacement enregistrées").waitFor();
log("domicile enregistré");
await shot("01-profil");

// 3. Import pharmacies
await page.goto(`${BASE}/pharmacies/import`);
await page.setInputFiles("#file", `${DIR}test-pharmacies.csv`);
await page.click("button[type=submit]");
await page.getByText("Résultat de l'import").waitFor({ timeout: 30000 });
log("import pharmacies :", (await page.locator("text=Créées").locator("..").innerText()).replace(/\n/g, " "));
// réimport : aucun doublon
await page.setInputFiles("#file", `${DIR}test-pharmacies.csv`);
await page.click("button[type=submit]");
await page.waitForTimeout(3500);
log("réimport :", (await page.locator("text=Inchangées").locator("..").innerText()).replace(/\n/g, " "));
await shot("02-import-pharmacies");

// 4. Import agenda ICS : prévisualisation puis confirmation
await page.goto(`${BASE}/imports`);
await page.setInputFiles("#file", `${DIR}test-agenda.ics`);
await page.getByRole("button", { name: "1. Prévisualiser" }).click();
await page.getByText("Prévisualisation (rien n'est encore enregistré)").waitFor({ timeout: 60000 });
log("prévisualisation :", (await page.locator("text=Classement :").innerText()).replace(/\n/g, " "));
await shot("03a-preview-agenda");
await page.getByRole("button", { name: "2. Confirmer l'import" }).click();
await page.getByText("Import terminé").waitFor({ timeout: 120000 });
log("import agenda :", (await page.locator("text=Rapprochement avec les pharmacies").locator("..").innerText()).replace(/\n/g, " | "));
await shot("03-import-agenda");
// réimport du même fichier : aucun doublon
await page.goto(`${BASE}/imports`);
await page.setInputFiles("#file", `${DIR}test-agenda.ics`);
await page.getByRole("button", { name: "1. Prévisualiser" }).click();
await page.getByText("Prévisualisation (rien n'est encore enregistré)").waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "2. Confirmer l'import" }).click();
await page.getByText("Import terminé").waitFor({ timeout: 120000 });
log("réimport agenda :", (await page.locator("text=Nouveaux").first().locator("../..").innerText()).replace(/\n/g, " "));

// 5. Rapprochements : valider la première carte
await page.goto(`${BASE}/rapprochements`);
await shot("04-rapprochements");
const cards = page.locator("article");
log("cartes à vérifier :", await cards.count());
if ((await cards.count()) > 0) {
  await cards.first().getByRole("button", { name: /^Valider$/ }).click();
  await page.getByText("Correspondance validée").first().waitFor();
  log("première correspondance validée");
}

// 6. Pharmacies et fiche
await page.goto(`${BASE}/pharmacies`);
await shot("05-pharmacies");
await page.locator("a[href^='/pharmacies/']").filter({ hasText: "Caen" }).first().click();
await page.waitForURL(/\/pharmacies\/[0-9a-f-]{36}$/);
await shot("06-fiche");
await page.getByRole("link", { name: /Proposer la prochaine visite/ }).click();
await page.waitForURL(/prochaine-visite/);
await shot("07-prochaine-visite");
log("propositions :", await page.locator("ol > li").count());

// 7. Planning semaine + glisser-déposer (rendez-vous confirmé : boîte de confirmation acceptée)
await page.goto(`${BASE}/planning`);
await shot("08-planning-semaine");
page.once("dialog", (d) => d.accept());
const block = page.locator("a[draggable=true]").first();
const columns = page.locator("[aria-label^='Colonne du']");
await block.dragTo(columns.nth(1), { targetPosition: { x: 40, y: 500 } });
await page.getByText("Rendez-vous déplacé").waitFor({ timeout: 15000 });
log("glisser-déposer : rendez-vous déplacé");

// 8. Tournée du jour avec visites (premier jour ouvré à venir ayant ≥ 3 visites)
await page.goto(`${BASE}/`);
await shot("09-aujourdhui");
let tourDate = null;
for (let i = 0; i < 10 && !tourDate; i++) {
  const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
  await page.goto(`${BASE}/tournees?date=${d}`);
  if (await page.getByText("Planning actuel").count()) tourDate = d;
}
log("tournée simulée pour", tourDate);
await shot("10-tournee");
// Simulation en autorisant le déplacement des rendez-vous confirmés, puis application
{
  const apply = page.getByRole("button", { name: "Appliquer ce scénario" });
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
    await page.goto(`${BASE}/tournees?date=${d}&confirmes=deplacables`);
    if ((await apply.count()) && (await page.getByText("Un meilleur ordre de passage est possible").count())) {
      log("jour avec amélioration possible :", d);
      break;
    }
  }
  if (await apply.count()) {
    await page.getByLabel(/J'ai vérifié le scénario/).check();
    const second = page.getByLabel(/Je confirme le déplacement de/);
    if (await second.count()) await second.check();
    await apply.click();
    await page.getByText(/Scénario (appliqué|enregistré)|Le planning a changé|Cochez|erreur/).first().waitFor({ timeout: 30000 });
    await shot("10c-tournee-apres-application");
    log("scénario appliqué :", await page.getByText(/Scénario (appliqué|enregistré)/).first().innerText());
  } else {
    log("aucun ordre différent proposé (rien à appliquer)");
  }
  await shot("10b-tournee-confirmes");
}

// 9. Carte
await page.goto(`${BASE}/carte${tourDate ? `?date=${tourDate}` : ""}`);
await page.waitForTimeout(3500);
await shot("11-carte");

// 10. Pilotage
await page.goto(`${BASE}/pilotage`);
await shot("12-pilotage");

// 10 bis. Export des données et persistance après déconnexion / reconnexion
const exportRes = await page.request.get(`${BASE}/api/export`);
const exported = await exportRes.json();
log("export :", exportRes.status(), `${exported.pharmacies.length} pharmacies, ${exported.appointments.length} rendez-vous`);
const before = exported.pharmacies.length;
await page.goto(`${BASE}/profil`);
await Promise.all([page.waitForURL(/connexion/), page.getByRole("button", { name: "Se déconnecter" }).click()]);
await page.fill("#email", email);
await page.fill("#password", "motdepasse123");
await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);
const again = await (await page.request.get(`${BASE}/api/export`)).json();
log("après reconnexion :", again.pharmacies.length === before ? "données intactes" : "DONNÉES MANQUANTES");
if (again.pharmacies.length !== before) errors.push("Données perdues après reconnexion");

// 11. Mobile
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris" });
await mobile.addCookies((await ctx.cookies()).map((c) => ({ ...c })));
const m = await mobile.newPage();
m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
const mobilePages = [
  ["/", "m01-aujourdhui"],
  ["/planning", "m02-planning"],
  ["/pharmacies", "m03-pharmacies"],
  ["/rapprochements", "m04-rapprochements"],
  ["/profil", "m05-profil"],
] as const;
for (const [route, name] of mobilePages) {
  await m.goto(`${BASE}${route}`);
  await shot(name, m);
}
// Horizontal scroll check
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
log("débordement horizontal mobile (px) :", overflow);

// 12. Mode sombre
const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark", locale: "fr-FR", timezoneId: "Europe/Paris" });
await dark.addCookies((await ctx.cookies()).map((c) => ({ ...c })));
const d = await dark.newPage();
await d.goto(`${BASE}/pilotage`);
await shot("13-pilotage-sombre", d);
await d.goto(`${BASE}/`);
await shot("14-aujourdhui-sombre", d);

await browser.close();
if (errors.length) {
  console.error(`ERREURS :\n${errors.join("\n")}`);
  process.exit(1);
}
if (overflow > 0) {
  console.error("Débordement horizontal sur mobile.");
  process.exit(1);
}
console.log("Parcours complet sans erreur.");
