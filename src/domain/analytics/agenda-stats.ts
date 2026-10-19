/**
 * Statistiques du secteur à partir de l'agenda : secteurs réellement travaillés
 * chaque jour (comparés à la semaine type), nuits d'hôtel, rendez-vous
 * téléphoniques, kilomètres estimés et couverture des clientes.
 *
 * Les kilomètres sont des ESTIMATIONS (vol d'oiseau × coefficient de détour) :
 * calculer des centaines de journées passées par un moteur routier n'apporterait
 * pas grand-chose pour une vue d'ensemble.
 */
import type { HotelNight } from "../calendar/hotels";
import type { Category, FrequencySettings } from "../frequency";
import { haversineKm, type LatLng } from "../geo";
import { DEFAULT_ESTIMATE, estimateLeg, type EstimateParams } from "../routing/estimate";
import { addDays, isoWeekday, minutesOfDay, startOfIsoWeek, type DayKey } from "../time";

export type StatsVisit = {
  id: string;
  day: DayKey;
  start: Date;
  end: Date;
  pharmacyId: string;
  pharmacyName: string;
  city: string | null;
  departmentCode: string | null;
  location: LatLng | null;
  mode: "onsite" | "phone";
  /** Détection téléphonique en attente de validation */
  pendingReview: boolean;
  reason: string | null;
};

export type StatsClient = { id: string; name: string; city: string | null; departmentCode: string | null; category: Category | null };

export type AgendaStatsInput = {
  visits: StatsVisit[];
  nights: HotelNight[];
  teleworkDays: DayKey[];
  clients: StatsClient[];
  home: LatLng | null;
  /** Semaine type : jour ISO → départements prévus */
  template: Record<number, string[]>;
  targets: FrequencySettings;
  today: DayKey;
  tz: string;
  estimate?: EstimateParams;
};

export type StatsDay = {
  day: DayKey;
  weekday: number;
  onsite: number;
  phone: number;
  /** 1 ou 2 départements (3 si journée très dispersée), du plus visité au moins visité */
  sectors: string[];
  matchesTemplate: boolean | null;
  firstStart: number | null;
  lastEnd: number | null;
  startFrom: string;
  night: HotelNight | null;
  km: number | null;
  driveMinutes: number | null;
  /** Distance au domicile du point le plus éloigné (km estimés) */
  farthestKm: number | null;
  telework: boolean;
  visits: StatsVisit[];
};

const ROUND = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Secteurs d'une journée : le département dominant, ou les deux principaux si la journée est partagée. */
export function daySectors(codes: string[]): string[] {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const total = codes.length;
  if (ranked[0]![1] / total >= 0.75) return [ranked[0]![0]];
  const two = ranked.slice(0, 2);
  if (ranked.length > 2 && (two[0]![1] + two[1]![1]) / total < 0.8) return ranked.slice(0, 3).map(([c]) => c);
  return two.map(([c]) => c);
}

export function buildDays(input: AgendaStatsInput): StatsDay[] {
  const estimate = input.estimate ?? DEFAULT_ESTIMATE;
  const nights = new Map(input.nights.map((n) => [n.night, n]));
  const telework = new Set(input.teleworkDays);
  const byDay = new Map<DayKey, StatsVisit[]>();
  for (const v of input.visits) byDay.set(v.day, [...(byDay.get(v.day) ?? []), v]);
  const days: StatsDay[] = [];
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    const onsite = list.filter((v) => v.mode === "onsite");
    const sectors = daySectors(onsite.map((v) => v.departmentCode).filter((c): c is string => Boolean(c)));
    const weekday = isoWeekday(day);
    const planned = input.template[weekday] ?? [];
    const prevNight = nights.get(addDays(day, -1)) ?? null;
    const night = nights.get(day) ?? null;
    const start = prevNight?.location ?? input.home;
    const end = night?.location ?? input.home;
    let km: number | null = null;
    let driveMinutes: number | null = null;
    let farthestKm: number | null = null;
    const stops = onsite.filter((v) => v.location).map((v) => v.location!);
    if (start && end && stops.length) {
      km = 0;
      driveMinutes = 0;
      const path = [start, ...stops, end];
      for (let i = 1; i < path.length; i++) {
        const leg = estimateLeg(path[i - 1]!, path[i]!, estimate);
        km += leg.km;
        driveMinutes += leg.minutes;
      }
      if (input.home) farthestKm = Math.max(...stops.map((p) => haversineKm(input.home!, p) * estimate.roadFactor));
    }
    days.push({
      day,
      weekday,
      onsite: onsite.length,
      phone: list.length - onsite.length,
      sectors,
      matchesTemplate: planned.length && sectors.length ? sectors.some((s) => planned.includes(s)) : null,
      firstStart: onsite.length ? minutesOfDay(onsite[0]!.start, input.tz) : null,
      lastEnd: onsite.length ? Math.max(...onsite.map((v) => minutesOfDay(v.end, input.tz))) : null,
      startFrom: prevNight ? (prevNight.city ?? prevNight.hotel) : "domicile",
      night,
      km,
      driveMinutes,
      farthestKm,
      telework: telework.has(day),
      visits: list,
    });
  }
  return days;
}

export type AgendaStats = ReturnType<typeof buildAgendaStats>;

export function buildAgendaStats(input: AgendaStatsInput) {
  const estimate = input.estimate ?? DEFAULT_ESTIMATE;
  const yearStart = addDays(input.today, -365);
  const allDays = buildDays(input);
  const past = allDays.filter((d) => d.day < input.today);
  const year = past.filter((d) => d.day >= yearStart);
  const fieldYear = year.filter((d) => d.onsite > 0);
  const yearVisits = year.flatMap((d) => d.visits);
  const nightsYear = input.nights.filter((n) => n.night >= yearStart && n.night < input.today);
  const kmDays = fieldYear.filter((d) => d.km !== null);

  // --- Mois ---
  const months = new Map<string, { onsite: number; phone: number; days: number; nights: number; km: number }>();
  const month = (k: string) => months.get(k) ?? { onsite: 0, phone: 0, days: 0, nights: 0, km: 0 };
  for (const d of year) {
    const m = month(d.day.slice(0, 7));
    m.onsite += d.onsite;
    m.phone += d.phone;
    if (d.onsite) m.days++;
    m.km += d.km ?? 0;
    months.set(d.day.slice(0, 7), m);
  }
  for (const n of nightsYear) {
    const m = month(n.night.slice(0, 7));
    m.nights++;
    months.set(n.night.slice(0, 7), m);
  }

  // --- Jours de la semaine ---
  const weekdays = [1, 2, 3, 4, 5].map((wd) => {
    const ds = fieldYear.filter((d) => d.weekday === wd);
    const main = new Map<string, number>();
    for (const d of ds) if (d.sectors[0]) main.set(d.sectors[0], (main.get(d.sectors[0]) ?? 0) + 1);
    const judged = ds.filter((d) => d.matchesTemplate !== null);
    return {
      weekday: wd,
      days: ds.length,
      sectors: [...main.entries()].sort((a, b) => b[1] - a[1]).map(([code, days]) => ({ code, days, share: days / ds.length })),
      template: input.template[wd] ?? [],
      templateMatch: judged.length ? judged.filter((d) => d.matchesTemplate).length / judged.length : null,
      twoSectors: ds.length ? ds.filter((d) => d.sectors.length >= 2).length / ds.length : 0,
      onsitePerDay: avg(ds.map((d) => d.onsite)),
      phonePerDay: avg(year.filter((d) => d.weekday === wd).map((d) => d.phone)),
      nights: nightsYear.filter((n) => isoWeekday(n.night) === wd).length,
      kmPerDay: avg(ds.filter((d) => d.km !== null).map((d) => d.km!)),
      start: avg(ds.filter((d) => d.firstStart !== null).map((d) => d.firstStart!)),
      end: avg(ds.filter((d) => d.lastEnd !== null).map((d) => d.lastEnd!)),
    };
  });

  // --- Hôtels ---
  const perWeek = new Map<DayKey, number>();
  for (const n of nightsYear) perWeek.set(startOfIsoWeek(n.night), (perWeek.get(startOfIsoWeek(n.night)) ?? 0) + 1);
  const hotelCounts = new Map<string, { hotel: string; city: string | null; nights: number }>();
  for (const n of nightsYear) {
    const key = `${n.hotel.toLowerCase()}|${n.city ?? ""}`;
    const h = hotelCounts.get(key) ?? { hotel: n.hotel, city: n.city, nights: 0 };
    h.nights++;
    hotelCounts.set(key, h);
  }
  const byDay = new Map(allDays.map((d) => [d.day, d]));
  const savings = nightsYear
    .map((n) => {
      const today = byDay.get(n.night);
      const tomorrow = byDay.get(addDays(n.night, 1));
      const last = today?.visits.filter((v) => v.mode === "onsite" && v.location).at(-1)?.location;
      const first = tomorrow?.visits.find((v) => v.mode === "onsite" && v.location)?.location;
      if (!n.location || !last || !first || !input.home) return null;
      const leg = (a: LatLng, b: LatLng) => estimateLeg(a, b, estimate);
      const home = leg(last, input.home).km + leg(input.home, first).km - leg(last, n.location).km - leg(n.location, first).km;
      const minutes = leg(last, input.home).minutes + leg(input.home, first).minutes - leg(last, n.location).minutes - leg(n.location, first).minutes;
      const sameSector = Boolean(n.departmentCode && tomorrow?.sectors.includes(n.departmentCode));
      return { km: home, minutes, sameSector };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const dayTrips = fieldYear
    .filter((d) => !d.night && d.startFrom === "domicile" && (d.farthestKm ?? 0) > 150)
    .map((d) => ({ day: d.day, sectors: d.sectors, km: d.km, farthestKm: d.farthestKm }));

  // --- Couverture des clientes ---
  const onsiteByClient = new Map<string, number>();
  const contactByClient = new Map<string, number>();
  const lastOnsite = new Map<string, DayKey>();
  for (const v of yearVisits) {
    contactByClient.set(v.pharmacyId, (contactByClient.get(v.pharmacyId) ?? 0) + 1);
    if (v.mode === "onsite") onsiteByClient.set(v.pharmacyId, (onsiteByClient.get(v.pharmacyId) ?? 0) + 1);
  }
  for (const d of past) for (const v of d.visits) if (v.mode === "onsite") lastOnsite.set(v.pharmacyId, v.day);
  const coverage = (["A", "B", "C", "D"] as const).map((cat) => {
    const cs = input.clients.filter((c) => c.category === cat);
    const target = input.targets[cat];
    return {
      category: cat,
      clients: cs.length,
      seen: cs.filter((c) => contactByClient.has(c.id)).length,
      onsitePerClient: avg(cs.map((c) => onsiteByClient.get(c.id) ?? 0)),
      target,
      reached: cs.filter((c) => (onsiteByClient.get(c.id) ?? 0) >= target).length,
    };
  });
  const sixMonths = addDays(input.today, -182);
  const notSeen = input.clients
    .map((c) => ({ ...c, lastOnsite: lastOnsite.get(c.id) ?? null }))
    .filter((c) => !c.lastOnsite || c.lastOnsite < sixMonths)
    .sort((a, b) => (a.category ?? "Z").localeCompare(b.category ?? "Z") || (a.lastOnsite ?? "").localeCompare(b.lastOnsite ?? ""));
  const byDepartment = [...new Set(input.clients.map((c) => c.departmentCode ?? "?"))]
    .map((code) => {
      const cs = input.clients.filter((c) => (c.departmentCode ?? "?") === code);
      return { code, clients: cs.length, seen: cs.filter((c) => contactByClient.has(c.id)).length, onsiteVisits: cs.reduce((n, c) => n + (onsiteByClient.get(c.id) ?? 0), 0) };
    })
    .sort((a, b) => b.clients - a.clients);

  const phoneYear = yearVisits.filter((v) => v.mode === "phone");
  return {
    period: { from: yearStart, to: addDays(input.today, -1), firstVisit: input.visits[0]?.day ?? null },
    kpis: {
      onsite: yearVisits.length - phoneYear.length,
      phone: phoneYear.length,
      phonePending: input.visits.filter((v) => v.pendingReview).length,
      fieldDays: fieldYear.length,
      teleworkDays: new Set(input.teleworkDays.filter((d) => d >= yearStart && d < input.today)).size,
      nights: nightsYear.length,
      km: kmDays.length ? ROUND(kmDays.reduce((s, d) => s + d.km!, 0)) : null,
      kmPerDay: avg(kmDays.map((d) => d.km!)),
      driveHours: kmDays.length ? kmDays.reduce((s, d) => s + d.driveMinutes!, 0) / 60 : null,
      clientsSeen: input.clients.filter((c) => contactByClient.has(c.id)).length,
      clients: input.clients.length,
      upcoming: input.visits.filter((v) => v.day >= input.today).length,
    },
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ month: m, ...v })),
    weekdays,
    hotels: {
      byWeekday: [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ weekday: wd, nights: nightsYear.filter((n) => isoWeekday(n.night) === wd).length })),
      weeks: { one: [...perWeek.values()].filter((n) => n === 1).length, two: [...perWeek.values()].filter((n) => n === 2).length, more: [...perWeek.values()].filter((n) => n >= 3).length },
      top: [...hotelCounts.values()].sort((a, b) => b.nights - a.nights).slice(0, 8),
      savedKmPerNight: avg(savings.map((s) => s.km)),
      savedMinutesPerNight: avg(savings.map((s) => s.minutes)),
      sameSectorShare: savings.length ? savings.filter((s) => s.sameSector).length / savings.length : null,
      dayTrips,
      upcoming: input.nights.filter((n) => n.night >= input.today),
    },
    coverage,
    byDepartment,
    notSeen,
    lastMonth: past.filter((d) => d.day >= addDays(input.today, -31)),
    lastWeeks: past.filter((d) => d.day >= addDays(startOfIsoWeek(input.today), -21)),
  };
}
