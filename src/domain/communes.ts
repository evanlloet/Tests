/**
 * Centre approximatif d'une commune à partir de son code postal et de son nom,
 * pour les fiches sans adresse ni coordonnées (fichier clients, par exemple).
 * La position obtenue est marquée « approximative » (précision « city ») : elle
 * suffit à estimer des trajets entre communes, pas à se rendre à l'officine.
 */
import data from "@/data/communes-ouest.json";
import { normalizeCity } from "./text";

type CommuneEntry = { c: string; n: string[]; cp: string[]; lat: number; lng: number; p?: string };

export type CommuneLocation = {
  code: string;
  name: string;
  lat: number;
  lng: number;
  /** commune : centre de la commune ; commune-nouvelle : centre de la commune nouvelle (commune déléguée sans tracé propre) ; code-postal : commune non reconnue, seule commune du code postal */
  basis: "commune" | "commune-nouvelle" | "code-postal";
};

export const COMMUNE_DEPARTMENTS: readonly string[] = data.departments;

const ENTRIES = data.communes as CommuneEntry[];

/** « Le Hom » ≈ « Hom », « Saint-Lô » ≈ « St Lo ». */
function key(name: string): string {
  return normalizeCity(name).replace(/^(le|la|les|l) /, "");
}

let index: Map<string, CommuneEntry[]> | null = null;
let byPostalCode: Map<string, CommuneEntry[]> | null = null;

function indexes() {
  if (!index || !byPostalCode) {
    index = new Map();
    byPostalCode = new Map();
    for (const e of ENTRIES) {
      for (const n of e.n) {
        const k = key(n);
        const list = index.get(k) ?? [];
        if (!list.includes(e)) list.push(e);
        index.set(k, list);
      }
      for (const cp of e.cp) {
        const list = byPostalCode.get(cp) ?? [];
        list.push(e);
        byPostalCode.set(cp, list);
      }
    }
  }
  return { index, byPostalCode };
}

const located = (e: CommuneEntry, basis?: CommuneLocation["basis"]): CommuneLocation => ({
  code: e.c,
  name: e.p ?? e.n[0]!,
  lat: e.lat,
  lng: e.lng,
  basis: basis ?? (e.p ? "commune-nouvelle" : "commune"),
});

/** Plusieurs entrées au même endroit comptent pour une seule. */
function single(list: CommuneEntry[]): CommuneEntry | null {
  const first = list[0];
  if (!first) return null;
  return list.every((e) => e.lat === first.lat && e.lng === first.lng) ? first : null;
}

/**
 * Retrouve la commune (nom + code postal). Rien n'est deviné : si le nom ne
 * correspond à aucune commune et que le code postal en couvre plusieurs, la
 * fonction renvoie null.
 */
export function locateCommune(postalCode: string | null | undefined, city: string | null | undefined): CommuneLocation | null {
  const { index, byPostalCode } = indexes();
  const cp = (postalCode ?? "").replace(/\s/g, "");
  const name = city ? key(city) : "";
  if (name) {
    const byName = index.get(name) ?? [];
    const sameCp = byName.filter((e) => e.cp.includes(cp));
    const exact = single(sameCp.filter((e) => !e.p)) ?? single(sameCp);
    if (exact) return located(exact);
    if (!cp) {
      const only = single(byName);
      if (only) return located(only);
    } else if (sameCp.length === 0) {
      const sameDept = single(byName.filter((e) => e.c.slice(0, 2) === cp.slice(0, 2)));
      if (sameDept) return located(sameDept);
    }
    // « Cherbourg » → « Cherbourg-en-Cotentin », « Vire » → « Vire Normandie » (même code postal)
    if (cp) {
      const partial = (byPostalCode.get(cp) ?? []).filter((e) =>
        e.n.some((n) => {
          const k = key(n);
          return k.startsWith(`${name} `) || name.startsWith(`${k} `);
        }),
      );
      const p = single(partial);
      if (p) return located(p);
    }
  }
  const onlyOne = cp ? single(byPostalCode.get(cp) ?? []) : null;
  return onlyOne ? located(onlyOne, "code-postal") : null;
}

export const COMMUNE_BASIS_LABEL: Record<CommuneLocation["basis"], string> = {
  commune: "centre de la commune",
  "commune-nouvelle": "centre de la commune nouvelle",
  "code-postal": "centre de la seule commune du code postal",
};
