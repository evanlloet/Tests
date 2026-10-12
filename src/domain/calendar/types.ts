/** Événement de calendrier normalisé, indépendant du format d'origine (ICS ou CSV Outlook). */
export type ParsedCalendarEvent = {
  /** Clé stable permettant de rejouer un import sans créer de doublon */
  sourceKey: string;
  /** Empreinte titre + horaires : détecte un même événement importé sous deux formats */
  contentHash: string;
  uid: string | null;
  recurrenceId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Fuseau indiqué par la source (TZID, ou fuseau de l'utilisatrice pour un CSV) */
  sourceTimezone: string | null;
  isCancelled: boolean;
  isRecurring: boolean;
  /** Données d'origine, conservées sans modification */
  raw: Record<string, unknown>;
};

export type CalendarParseResult = {
  format: "ics" | "outlook_csv";
  events: ParsedCalendarEvent[];
  /** Lignes ou événements ignorés, avec la raison — affichés dans la prévisualisation */
  warnings: string[];
  /** Nombre d'entrées lues dans le fichier (avant expansion des récurrences) */
  sourceEntries: number;
};
