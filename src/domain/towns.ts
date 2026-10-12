/**
 * Communes proposées pour le domicile lors de l'accueil. Coordonnées approximatives
 * du centre-ville (précision « commune ») : suffisantes pour estimer les trajets,
 * affinables ensuite dans le profil (adresse exacte ou coordonnées).
 */
export type Town = { key: string; name: string; departmentCode: string; lat: number; lng: number };

export const TOWNS: Town[] = [
  { key: "rennes", name: "Rennes", departmentCode: "35", lat: 48.1173, lng: -1.6778 },
  { key: "saint-malo", name: "Saint-Malo", departmentCode: "35", lat: 48.6493, lng: -2.0257 },
  { key: "fougeres", name: "Fougères", departmentCode: "35", lat: 48.3525, lng: -1.1986 },
  { key: "vitre", name: "Vitré", departmentCode: "35", lat: 48.1236, lng: -1.2097 },
  { key: "redon", name: "Redon", departmentCode: "35", lat: 47.6514, lng: -2.0842 },
  { key: "cesson-sevigne", name: "Cesson-Sévigné", departmentCode: "35", lat: 48.1211, lng: -1.6031 },
  { key: "bruz", name: "Bruz", departmentCode: "35", lat: 48.0247, lng: -1.7458 },
  { key: "saint-gregoire", name: "Saint-Grégoire", departmentCode: "35", lat: 48.1508, lng: -1.6853 },
  { key: "dinard", name: "Dinard", departmentCode: "35", lat: 48.6325, lng: -2.0617 },
  { key: "caen", name: "Caen", departmentCode: "14", lat: 49.1829, lng: -0.3707 },
  { key: "bayeux", name: "Bayeux", departmentCode: "14", lat: 49.2764, lng: -0.7024 },
  { key: "lisieux", name: "Lisieux", departmentCode: "14", lat: 49.1466, lng: 0.2266 },
  { key: "vire", name: "Vire Normandie", departmentCode: "14", lat: 48.8386, lng: -0.8892 },
  { key: "falaise", name: "Falaise", departmentCode: "14", lat: 48.8961, lng: -0.1934 },
  { key: "honfleur", name: "Honfleur", departmentCode: "14", lat: 49.4189, lng: 0.2331 },
  { key: "saint-lo", name: "Saint-Lô", departmentCode: "50", lat: 49.1157, lng: -1.0906 },
  { key: "cherbourg", name: "Cherbourg-en-Cotentin", departmentCode: "50", lat: 49.6337, lng: -1.6222 },
  { key: "coutances", name: "Coutances", departmentCode: "50", lat: 49.0476, lng: -1.4452 },
  { key: "granville", name: "Granville", departmentCode: "50", lat: 48.8378, lng: -1.5975 },
  { key: "avranches", name: "Avranches", departmentCode: "50", lat: 48.6844, lng: -1.3569 },
  { key: "alencon", name: "Alençon", departmentCode: "61", lat: 48.4329, lng: 0.0913 },
  { key: "argentan", name: "Argentan", departmentCode: "61", lat: 48.7444, lng: -0.0203 },
  { key: "flers", name: "Flers", departmentCode: "61", lat: 48.75, lng: -0.5667 },
  { key: "laigle", name: "L'Aigle", departmentCode: "61", lat: 48.7647, lng: 0.6286 },
  { key: "laval", name: "Laval", departmentCode: "53", lat: 48.0706, lng: -0.7734 },
  { key: "mayenne", name: "Mayenne", departmentCode: "53", lat: 48.3031, lng: -0.6136 },
  { key: "chateau-gontier", name: "Château-Gontier-sur-Mayenne", departmentCode: "53", lat: 47.8286, lng: -0.7028 },
  { key: "nantes", name: "Nantes", departmentCode: "44", lat: 47.2184, lng: -1.5536 },
  { key: "le-mans", name: "Le Mans", departmentCode: "72", lat: 48.0061, lng: 0.1996 },
  { key: "angers", name: "Angers", departmentCode: "49", lat: 47.4784, lng: -0.5632 },
  { key: "saint-brieuc", name: "Saint-Brieuc", departmentCode: "22", lat: 48.5136, lng: -2.7653 },
  { key: "rouen", name: "Rouen", departmentCode: "76", lat: 49.4431, lng: 1.0993 },
];

export function townByKey(key: string): Town | undefined {
  return TOWNS.find((t) => t.key === key);
}

/** Couleurs proposées aux nouveaux secteurs (validées pour le daltonisme avec les 5 initiales). */
export const EXTRA_SECTOR_COLORS = ["#0891b2", "#65a30d", "#c026d3", "#ea580c", "#4f46e5", "#be123c"];
