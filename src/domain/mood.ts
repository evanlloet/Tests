/**
 * Humeur des journées et des pharmacies, représentée par de petits bonshommes.
 *
 * L'humeur d'une journée ne dépend pas seulement du nombre de rendez-vous : elle
 * reflète la charge réelle (visites + trajets estimés + pause rapportés à
 * l'amplitude de travail) et les problèmes détectés (chevauchements, journée
 * irréaliste), conformément au brief.
 */
import type { DueState } from "./frequency";

export type Mood = "joy" | "happy" | "calm" | "meh" | "worried" | "stressed" | "sleepy" | "love";
export type BuddyShape = "circle" | "squircle" | "blob" | "triangle" | "flower" | "bolt";
export type BuddyColor = "green" | "yellow" | "orange" | "blue" | "pink" | "purple" | "red" | "gray";

export type LoadLevel = "vide" | "légère" | "équilibrée" | "chargée" | "trop chargée";

export type DayMoodKey = "weekend" | "holiday" | "free" | "light" | "balanced" | "busy" | "overloaded";

export type MoodVisual = {
  mood: Mood;
  shape: BuddyShape;
  color: BuddyColor;
  label: string;
  hint: string;
};

export const DAY_MOODS: Record<DayMoodKey, MoodVisual> = {
  weekend: { mood: "sleepy", shape: "blob", color: "blue", label: "Repos", hint: "Week-end : on recharge les batteries" },
  holiday: { mood: "sleepy", shape: "blob", color: "blue", label: "Férié", hint: "Jour férié" },
  free: { mood: "calm", shape: "circle", color: "purple", label: "Libre", hint: "Aucune visite prévue" },
  light: { mood: "happy", shape: "circle", color: "green", label: "Tranquille", hint: "Journée légère, de la marge pour les imprévus" },
  balanced: { mood: "joy", shape: "flower", color: "yellow", label: "Idéale", hint: "Journée bien remplie et réaliste" },
  busy: { mood: "meh", shape: "squircle", color: "orange", label: "Chargée", hint: "Peu de marge : surveillez les trajets" },
  overloaded: { mood: "stressed", shape: "triangle", color: "red", label: "Trop chargée", hint: "Visites et trajets dépassent la journée, ou rendez-vous qui se chevauchent" },
};

export function dayMoodKey(input: {
  load: LoadLevel;
  weekday: number;
  holiday: string | null;
  visits: number;
  overlaps: boolean;
}): DayMoodKey {
  if (input.visits === 0) {
    if (input.holiday) return "holiday";
    if (input.weekday > 5) return "weekend";
    return "free";
  }
  if (input.overlaps || input.load === "trop chargée") return "overloaded";
  if (input.load === "chargée") return "busy";
  if (input.load === "équilibrée") return "balanced";
  return "light";
}

export function dayMood(input: Parameters<typeof dayMoodKey>[0]): MoodVisual & { key: DayMoodKey } {
  const key = dayMoodKey(input);
  return { key, ...DAY_MOODS[key] };
}

/** Humeur d'une pharmacie selon le suivi de ses visites. */
export const PHARMACY_MOODS: Record<DueState, { mood: Mood; label: string }> = {
  ok: { mood: "happy", label: "Contente de votre suivi" },
  planned: { mood: "love", label: "Rendez-vous prévu, elle vous attend" },
  due_soon: { mood: "calm", label: "Bientôt l'heure de repasser" },
  overdue: { mood: "worried", label: "Elle ne vous a pas vue depuis longtemps" },
  never_visited: { mood: "sleepy", label: "Pas encore rencontrée" },
  unknown: { mood: "calm", label: "Catégorie à compléter" },
};

const AVATAR_SHAPES: BuddyShape[] = ["circle", "squircle", "blob", "flower", "triangle", "bolt"];
const AVATAR_COLORS: BuddyColor[] = ["green", "yellow", "orange", "blue", "pink", "purple"];

/** Avatar stable d'une pharmacie (forme et couleur déduites de son identifiant). */
export function avatarFor(id: string): { shape: BuddyShape; color: BuddyColor } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = h >>> 0;
  return { shape: AVATAR_SHAPES[n % AVATAR_SHAPES.length]!, color: AVATAR_COLORS[Math.floor(n / 7) % AVATAR_COLORS.length]! };
}
