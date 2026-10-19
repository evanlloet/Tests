/**
 * Nuits d'hôtel déduites de l'agenda. Les réservations apparaissent en général
 * comme des événements « journée entière » allant du jour d'arrivée au jour de
 * départ (« LEA LONGY - ibis Caen Porte de Bretagne, 5297AIR0500 », adresse dans
 * le lieu) : un événement sur 2 jours = 1 nuit, sur 3 jours = 2 nuits.
 */
import { locateCommune } from "../communes";
import type { LatLng } from "../geo";
import { normalizeText } from "../text";
import { addDays, dayKeyOf, diffDays, type DayKey } from "../time";

export type HotelEventInput = {
  title: string;
  location: string | null;
  allDay: boolean;
  start: Date;
  end: Date;
  isCancelled?: boolean;
};

export type HotelNight = {
  /** Soir de la nuit passée à l'hôtel */
  night: DayKey;
  hotel: string;
  city: string | null;
  postalCode: string | null;
  departmentCode: string | null;
  /** Centre de la commune de l'hôtel (approximatif) */
  location: LatLng | null;
};

const HOTEL_WORDS =
  /\b(hotel|hotels|ibis|novotel|mercure|campanile|kyriad|b b|logis|best western|premiere classe|fasthotel|appart city|residence hoteliere|chambres? d hotes|gite|auberge|villegiature)\b/;
const TRANSPORT = /\b(tgv|inoui|ouigo|ter|sncf|train|air france|vol|europcar|hertz|avis|sixt|ada|taxi|uber|parking|location de voiture)\b/;
const REGIONS = /^(normandy|normandie|bretagne|brittany|pays de la loire|centre val de loire|ile de france|france|fra)$/;

export function isHotelBooking(e: HotelEventInput): boolean {
  if (e.isCancelled || !e.allDay) return false;
  const title = normalizeText(e.title);
  if (TRANSPORT.test(title)) return false;
  if (HOTEL_WORDS.test(`${title} ${normalizeText(e.location)}`)) return true;
  // Réservation d'agence « NOM PRÉNOM - Établissement, référence » avec une adresse postale
  return /^[^-]{3,40} - \S/.test(e.title) && /\b\d{5}\b/.test(e.location ?? "");
}

/** « 1 Rue Du Fresne, Bretteville-sur-Odon, Normandy, 14760, FRA » → { cp: 14760, ville: Bretteville-sur-Odon } */
export function parseHotelAddress(location: string | null): { postalCode: string | null; city: string | null } {
  if (!location) return { postalCode: null, city: null };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const inline = parts[i]!.match(/^(\d{5})\s+(.+)$/);
    if (inline) return { postalCode: inline[1]!, city: inline[2]! };
    if (/^\d{5}$/.test(parts[i]!)) {
      const before = parts.slice(0, i).filter((p) => !REGIONS.test(normalizeText(p)) && !/^\d/.test(p));
      return { postalCode: parts[i]!, city: before.at(-1) ?? null };
    }
  }
  return { postalCode: location.match(/\b(\d{5})\b/)?.[1] ?? null, city: null };
}

export function hotelName(title: string): string {
  return title
    .replace(/^[^-]{3,40} - /, "")
    .replace(/,\s*[A-Z0-9]{6,}\s*$/, "")
    .replace(/^h[ôo]tel\s+(?=ibis|novotel|mercure|campanile|kyriad)/i, "")
    .trim();
}

/** Nuits d'hôtel (une par soir, sans doublon : la première réservation l'emporte). */
export function extractHotelNights(events: HotelEventInput[], tz: string): HotelNight[] {
  const nights = new Map<DayKey, HotelNight>();
  for (const e of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    if (!isHotelBooking(e)) continue;
    const first = dayKeyOf(e.start, tz);
    // Fin exclusive d'un événement « journée entière » : 2 jours couverts = 1 nuit
    const daysCovered = Math.max(1, diffDays(first, dayKeyOf(new Date(e.end.getTime() - 1), tz)) + 1);
    const count = Math.max(1, daysCovered - 1);
    const { postalCode, city } = parseHotelAddress(e.location);
    const commune = locateCommune(postalCode, city);
    for (let i = 0; i < count; i++) {
      const night = addDays(first, i);
      if (nights.has(night)) continue;
      nights.set(night, {
        night,
        hotel: hotelName(e.title),
        city: commune?.name ?? city,
        postalCode,
        departmentCode: postalCode ? postalCode.slice(0, 2) : null,
        location: commune ? { lat: commune.lat, lng: commune.lng } : null,
      });
    }
  }
  return [...nights.values()].sort((a, b) => a.night.localeCompare(b.night));
}
