/**
 * Générateur de DONNÉES DE TEST FICTIVES (noms de pharmacies inventés, communes
 * réelles avec coordonnées approximatives). Utilisé uniquement par les tests de
 * bout en bout et les captures d'écran : jamais chargé dans l'application.
 */

type Town = { city: string; cp: string; dept: string; lat: number; lng: number };

export const TOWNS: Town[] = [
  { city: "Caen", cp: "14000", dept: "14", lat: 49.1829, lng: -0.3707 },
  { city: "Bayeux", cp: "14400", dept: "14", lat: 49.2764, lng: -0.7024 },
  { city: "Lisieux", cp: "14100", dept: "14", lat: 49.1466, lng: 0.2266 },
  { city: "Falaise", cp: "14700", dept: "14", lat: 48.8961, lng: -0.1934 },
  { city: "Vire", cp: "14500", dept: "14", lat: 48.8386, lng: -0.8892 },
  { city: "Honfleur", cp: "14600", dept: "14", lat: 49.4189, lng: 0.2331 },
  { city: "Ouistreham", cp: "14150", dept: "14", lat: 49.2797, lng: -0.2589 },
  { city: "Deauville", cp: "14800", dept: "14", lat: 49.36, lng: 0.075 },
  { city: "Saint-Lô", cp: "50000", dept: "50", lat: 49.1157, lng: -1.0906 },
  { city: "Cherbourg-en-Cotentin", cp: "50100", dept: "50", lat: 49.6337, lng: -1.6222 },
  { city: "Coutances", cp: "50200", dept: "50", lat: 49.0476, lng: -1.4452 },
  { city: "Granville", cp: "50400", dept: "50", lat: 48.8378, lng: -1.5975 },
  { city: "Avranches", cp: "50300", dept: "50", lat: 48.6844, lng: -1.3569 },
  { city: "Valognes", cp: "50700", dept: "50", lat: 49.5086, lng: -1.4703 },
  { city: "Alençon", cp: "61000", dept: "61", lat: 48.4329, lng: 0.0913 },
  { city: "Argentan", cp: "61200", dept: "61", lat: 48.7444, lng: -0.0203 },
  { city: "Flers", cp: "61100", dept: "61", lat: 48.75, lng: -0.5667 },
  { city: "L'Aigle", cp: "61300", dept: "61", lat: 48.7647, lng: 0.6286 },
  { city: "Rennes", cp: "35000", dept: "35", lat: 48.1173, lng: -1.6778 },
  { city: "Saint-Malo", cp: "35400", dept: "35", lat: 48.6493, lng: -2.0257 },
  { city: "Fougères", cp: "35300", dept: "35", lat: 48.3525, lng: -1.1986 },
  { city: "Vitré", cp: "35500", dept: "35", lat: 48.1236, lng: -1.2097 },
  { city: "Cesson-Sévigné", cp: "35510", dept: "35", lat: 48.1211, lng: -1.6031 },
  { city: "Laval", cp: "53000", dept: "53", lat: 48.0706, lng: -0.7734 },
  { city: "Mayenne", cp: "53100", dept: "53", lat: 48.3031, lng: -0.6136 },
  { city: "Château-Gontier-sur-Mayenne", cp: "53200", dept: "53", lat: 47.8286, lng: -0.7028 },
  { city: "Évron", cp: "53600", dept: "53", lat: 48.1567, lng: -0.4011 },
];

const SURNAMES = ["Lemoine", "Morel", "Guérin", "Lebrun", "Hamel", "Duval", "Leroux", "Picard", "Bertin", "Lecomte", "Renaud", "Collet", "Marchand", "Fleury", "Gauthier", "Perrin", "Robin", "Lacroix", "Huet", "Besnard"];
const GENERIC = ["du Centre", "de la Gare", "des Halles", "du Marché", "de l'Église"];

export type DemoPharmacy = Town & { id: number; name: string; category: "A" | "B" | "C" | "D"; finess: string; lat: number; lng: number };

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoPharmacies(seed = 42): DemoPharmacy[] {
  const rand = rng(seed);
  const out: DemoPharmacy[] = [];
  let surname = 0;
  TOWNS.forEach((town, ti) => {
    const count = town.city === "Caen" || town.city === "Rennes" ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const generic = i === 1 && ti % 2 === 0;
      const name = generic ? `Pharmacie ${GENERIC[ti % GENERIC.length]}` : i === 0 && ti % 3 === 0 ? `Grande Pharmacie de ${town.city}` : `Pharmacie ${SURNAMES[surname++ % SURNAMES.length]}`;
      const r = rand();
      out.push({
        ...town,
        id: out.length,
        name,
        category: r < 0.2 ? "A" : r < 0.5 ? "B" : r < 0.8 ? "C" : "D",
        finess: `${town.dept}00${String(10000 + out.length * 37).slice(-5)}`.padEnd(9, "0"),
        lat: town.lat + (rand() - 0.5) * 0.02,
        lng: town.lng + (rand() - 0.5) * 0.03,
      });
    }
  });
  return out;
}

export function demoPharmacyCsv(list = demoPharmacies()): string {
  const rows = list.map((p) =>
    [p.name, `${1 + (p.id % 40)} rue de la République`, p.cp, p.city, p.finess, p.lat.toFixed(5).replace(".", ","), p.lng.toFixed(5).replace(".", ","), p.category].join(";"),
  );
  return ["Nom;Adresse;Code postal;Ville;FINESS;Latitude;Longitude;Catégorie", ...rows].join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");
const icsDate = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

/**
 * Agenda Outlook fictif (ICS) : ~2 ans d'historique et 3 semaines à venir, selon
 * le modèle de secteurs (lun/mar Calvados, mer/jeu Manche, ven Ille-et-Vilaine,
 * variante Orne/Mayenne une semaine sur quatre), avec du bruit réaliste.
 */
export function demoIcs(today: Date, seed = 7, list = demoPharmacies()): string {
  const rand = rng(seed);
  const events: string[] = [];
  const lastVisit = new Map<number, number>();
  const start = new Date(today.getTime() - 730 * 86_400_000);
  const end = new Date(today.getTime() + 21 * 86_400_000);
  let uid = 0;
  const push = (summary: string, s: Date, e: Date, extra: string[] = []) => {
    events.push(["BEGIN:VEVENT", `UID:demo-${uid++}@lea.test`, `SUMMARY:${summary}`, `DTSTART:${icsDate(s)}`, `DTEND:${icsDate(e)}`, ...extra, "END:VEVENT"].join("\r\n"));
  };
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const week = Math.floor(d.getTime() / (7 * 86_400_000));
    if (rand() < 0.06) {
      push("Congés", new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7)), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17)));
      continue;
    }
    const variant = week % 4 === 0;
    const dept = { 1: variant ? "61" : "14", 2: variant ? "61" : "14", 3: "50", 4: variant ? "53" : "50", 5: "35" }[dow]!;
    const candidates = list
      .filter((p) => p.dept === dept)
      .sort((a, b) => (lastVisit.get(a.id) ?? 0) - (lastVisit.get(b.id) ?? 0));
    const visits = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < visits && i < candidates.length; i++) {
      const p = candidates[i]!;
      lastVisit.set(p.id, d.getTime());
      const hour = [8, 10, 13, 15][i] ?? 16; // heures UTC (≈ 9 h–17 h en France)
      const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, rand() < 0.5 ? 0 : 30));
      const e = new Date(s.getTime() + (30 + Math.floor(rand() * 4) * 15) * 60_000);
      const r = rand();
      let title = `RDV ${p.name}`;
      if (r < 0.08) title = `Ph. ${p.name.replace(/^(Grande )?Pharmacie (de |du |des |de la |de l')?/, "")}`;
      else if (r < 0.12) title = p.name.replace(/e(\w)$/, "ee$1"); // faute de frappe
      // Vérité terrain (propriété ignorée par Léa) : sert à mesurer la précision du rapprochement
      const extra = [`X-LEA-TEST-FINESS:${p.finess}`, ...(rand() < 0.75 ? [`LOCATION:${p.city}`] : [])];
      if (rand() < 0.03) extra.push("STATUS:CANCELLED");
      push(title, s, e, extra);
    }
    if (dow === 1 && week % 2 === 0) {
      push("Réunion d'équipe Teams", new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16)), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17)));
    }
  }
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lea tests//FR", ...events, "END:VCALENDAR"].join("\r\n");
}
