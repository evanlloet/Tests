/**
 * Classement des événements importés : rendez-vous commercial probable, autre
 * événement, ou indéterminé (décidé ensuite par le rapprochement avec une pharmacie).
 * Chaque décision est accompagnée de sa raison, affichée à l'utilisatrice.
 */
import { normalizeText } from "../text";
import type { ParsedCalendarEvent } from "./types";

export type Classification = "visit" | "not_visit" | "unknown";

const NOT_VISIT_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(vca|tad|teletravail|tele travail)\b/, reason: "Télétravail" },
  { re: /^kc tache\b/, reason: "Tâche (CRM)" },
  { re: /\b(conges?|vacances|ferie|rtt|repos|absent|absence|arret maladie|maladie)\b/, reason: "Congé ou absence" },
  { re: /\b(formation|seminaire|convention|salon|webinaire?|e learning)\b/, reason: "Formation ou événement interne" },
  { re: /\b(reunion|point hebdo|point mensuel|visio|teams|zoom|conf call|call|comite|cycle)\b/, reason: "Réunion ou appel" },
  { re: /\b(dentiste|medecin|kine|ophtalmo|coiffeur|garage|controle technique|perso|personnel|anniversaire|ecole|creche|piscine|sport)\b/, reason: "Rendez-vous personnel" },
  { re: /\b(hotel|train|avion|vol|trajet|deplacement)\b/, reason: "Logistique de déplacement" },
  { re: /\b(administratif|reporting|crm|notes de frais|ndf)\b/, reason: "Tâche administrative" },
];

const VISIT_PATTERNS: RegExp[] = [/\bpharmacie\b/, /\bpharma\b/, /\bofficine\b/, /\bph\b/, /\bphie\b/, /\bphcie\b/, /\bgrande pharmacie\b/];

/** Format des CRM de laboratoire : « KC - Visite : <raison sociale> - <CP> <ville> » */
const CRM_VISIT = /^kc visite\b/;

/** Bloc de télétravail (« KC - Tâche : VCA / TAD », « Télétravail ») : les rendez-vous pris pendant ce créneau se font à distance. */
export function isTeleworkTitle(title: string): boolean {
  return /\b(vca|tad|teletravail|tele travail)\b/.test(normalizeText(title));
}

export type ClassificationResult = { classification: Classification; reason: string };

export function classifyEvent(
  event: Pick<ParsedCalendarEvent, "title" | "location" | "allDay" | "isCancelled" | "start" | "end">,
): ClassificationResult {
  if (event.isCancelled) return { classification: "not_visit", reason: "Événement annulé" };
  const title = normalizeText(event.title);
  const text = `${title} ${normalizeText(event.location)}`;
  const mentionsPharmacy = VISIT_PATTERNS.some((re) => re.test(text));
  if (CRM_VISIT.test(title) && !event.allDay) return { classification: "visit", reason: "Visite saisie dans le CRM (« KC - Visite »)" };

  for (const { re, reason } of NOT_VISIT_PATTERNS) {
    if (re.test(title) && !mentionsPharmacy) return { classification: "not_visit", reason };
  }
  if (event.allDay) {
    return mentionsPharmacy
      ? { classification: "unknown", reason: "Journée entière mentionnant une pharmacie : à vérifier" }
      : { classification: "not_visit", reason: "Événement sur la journée entière" };
  }
  const minutes = (event.end.getTime() - event.start.getTime()) / 60_000;
  if (minutes > 5 * 60) {
    return { classification: "not_visit", reason: "Durée supérieure à 5 h, peu compatible avec une visite" };
  }
  if (mentionsPharmacy) return { classification: "visit", reason: "Le titre ou le lieu mentionne une pharmacie" };
  return { classification: "unknown", reason: "Aucun indice décisif : dépend du rapprochement avec une pharmacie" };
}
