/**
 * Analyse de l'historique des visites (rendez-vous passés rattachés à une pharmacie).
 *
 * Rappel : un rendez-vous présent dans l'agenda n'est pas la preuve d'une visite
 * réalisée. Les analyses distinguent donc les visites « réalisées » des visites
 * « identifiées » (non confirmées).
 */
import { haversineKm, type LatLng } from "../geo";
import { estimateLeg, type EstimateParams } from "../routing/estimate";
import { dayKeyOf, diffDays, isoWeekday, type DayKey } from "../time";

export type HistoricalVisit = {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  departmentCode: string | null;
  location: LatLng | null;
  start: Date;
  end: Date;
  outcome: "unknown" | "done" | "missed";
};

export type HistoryAnalysis = {
  totals: {
    visits: number;
    done: number;
    identified: number;
    pharmacies: number;
    days: number;
    firstDay: DayKey | null;
    lastDay: DayKey | null;
    avgVisitsPerDay: number | null;
  };
  perPharmacy: {
    pharmacyId: string;
    name: string;
    departmentCode: string | null;
    count: number;
    lastDay: DayKey;
    avgIntervalDays: number | null;
  }[];
  weekdays: { weekday: number; visits: number; days: number }[];
  /** Secteurs visités par jour de semaine */
  sectorsByWeekday: { weekday: number; departments: { code: string | null; visits: number; share: number }[] }[];
  durations: { averageMin: number | null; medianMin: number | null; measured: number };
  /** Journées dont au moins une visite dépasse le seuil d'éloignement du domicile */
  farDays: {
    thresholdKm: number;
    count: number;
    byWeekday: { weekday: number; count: number }[];
    /** Suites de jours lointains consécutifs : nuits d'hôtel probables */
    consecutiveSequences: number;
  } | null;
  /** Kilométrage estimé des tournées (domicile → visites → domicile) */
  mileage: { totalKm: number; avgKmPerDay: number; daysMeasured: number; daysSkipped: number } | null;
  /** Pharmacies régulièrement visitées le même jour */
  clusters: { pharmacies: { id: string; name: string }[]; sharedDays: number; departmentCode: string | null }[];
  monthly: { month: string; visits: number }[];
};

export function analyzeHistory(input: {
  visits: HistoricalVisit[];
  tz: string;
  home: LatLng | null;
  hotelThresholdKm: number;
  estimate: EstimateParams;
  /** Nombre minimal de journées communes pour former un regroupement */
  clusterMinSharedDays?: number;
}): HistoryAnalysis {
  const { tz } = input;
  const visits = input.visits.filter((v) => v.outcome !== "missed").sort((a, b) => a.start.getTime() - b.start.getTime());
  const byDay = new Map<DayKey, HistoricalVisit[]>();
  for (const v of visits) {
    const day = dayKeyOf(v.start, tz);
    const list = byDay.get(day) ?? [];
    list.push(v);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].sort();

  // Par pharmacie
  const perPharmacyMap = new Map<string, { name: string; dept: string | null; days: DayKey[] }>();
  for (const v of visits) {
    const e = perPharmacyMap.get(v.pharmacyId) ?? { name: v.pharmacyName, dept: v.departmentCode, days: [] };
    const day = dayKeyOf(v.start, tz);
    if (e.days.at(-1) !== day) e.days.push(day);
    perPharmacyMap.set(v.pharmacyId, e);
  }
  const perPharmacy = [...perPharmacyMap.entries()]
    .map(([pharmacyId, e]) => ({
      pharmacyId,
      name: e.name,
      departmentCode: e.dept,
      count: e.days.length,
      lastDay: e.days.at(-1)!,
      avgIntervalDays: e.days.length > 1 ? Math.round(diffDays(e.days[0]!, e.days.at(-1)!) / (e.days.length - 1)) : null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));

  // Jours de semaine et secteurs
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const daysOfWeekday = days.filter((d) => isoWeekday(d) === weekday);
    return { weekday, days: daysOfWeekday.length, visits: daysOfWeekday.reduce((n, d) => n + byDay.get(d)!.length, 0) };
  });
  const sectorsByWeekday = weekdays
    .filter((w) => w.visits > 0)
    .map(({ weekday, visits: total }) => {
      const counts = new Map<string | null, number>();
      for (const d of days) {
        if (isoWeekday(d) !== weekday) continue;
        for (const v of byDay.get(d)!) counts.set(v.departmentCode, (counts.get(v.departmentCode) ?? 0) + 1);
      }
      return {
        weekday,
        departments: [...counts.entries()]
          .map(([code, n]) => ({ code, visits: n, share: n / total }))
          .sort((a, b) => b.visits - a.visits),
      };
    });

  // Durées (les événements sans durée sont exclus)
  const durations = visits
    .map((v) => (v.end.getTime() - v.start.getTime()) / 60_000)
    .filter((m) => m > 0 && m <= 5 * 60)
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations.length % 2
      ? durations[(durations.length - 1) / 2]!
      : (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2
    : null;

  // Journées lointaines et kilométrage estimé
  let farDays: HistoryAnalysis["farDays"] = null;
  let mileage: HistoryAnalysis["mileage"] = null;
  if (input.home) {
    const home = input.home;
    const far: DayKey[] = [];
    let totalKm = 0;
    let measured = 0;
    let skipped = 0;
    for (const d of days) {
      const located = byDay.get(d)!.filter((v) => v.location);
      if (located.some((v) => haversineKm(home, v.location!) * input.estimate.roadFactor > input.hotelThresholdKm)) far.push(d);
      if (located.length !== byDay.get(d)!.length || located.length === 0) {
        skipped++;
        continue;
      }
      let pos = home;
      let km = 0;
      for (const v of located) {
        km += estimateLeg(pos, v.location!, input.estimate).km;
        pos = v.location!;
      }
      km += estimateLeg(pos, home, input.estimate).km;
      totalKm += km;
      measured++;
    }
    let sequences = 0;
    for (let i = 1; i < far.length; i++) {
      if (diffDays(far[i - 1]!, far[i]!) === 1 && (i === 1 || diffDays(far[i - 2]!, far[i - 1]!) !== 1)) sequences++;
    }
    farDays = {
      thresholdKm: input.hotelThresholdKm,
      count: far.length,
      byWeekday: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, count: far.filter((d) => isoWeekday(d) === weekday).length })),
      consecutiveSequences: sequences,
    };
    mileage = { totalKm, avgKmPerDay: measured ? totalKm / measured : 0, daysMeasured: measured, daysSkipped: skipped };
  }

  // Regroupements : paires de pharmacies visitées le même jour au moins N fois
  const minShared = input.clusterMinSharedDays ?? 3;
  const pairCounts = new Map<string, number>();
  for (const d of days) {
    const ids = [...new Set(byDay.get(d)!.map((v) => v.pharmacyId))].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const strongPairs = [...pairCounts.entries()].filter(([, n]) => n >= minShared);
  for (const [key] of strongPairs) {
    const [a, b] = key.split("|") as [string, string];
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }
  const groups = new Map<string, Set<string>>();
  for (const id of parent.keys()) {
    const root = find(id);
    const g = groups.get(root) ?? new Set<string>();
    g.add(id);
    groups.set(root, g);
  }
  const clusters = [...groups.values()]
    .map((ids) => {
      const members = [...ids];
      const shared = Math.max(
        ...strongPairs.filter(([k]) => members.some((m) => k.startsWith(`${m}|`))).map(([, n]) => n),
      );
      const first = perPharmacyMap.get(members[0]!);
      return {
        pharmacies: members
          .map((id) => ({ id, name: perPharmacyMap.get(id)?.name ?? id }))
          .sort((a, b) => a.name.localeCompare(b.name, "fr")),
        sharedDays: shared,
        departmentCode: first?.dept ?? null,
      };
    })
    .sort((a, b) => b.sharedDays - a.sharedDays || b.pharmacies.length - a.pharmacies.length)
    .slice(0, 12);

  const monthlyMap = new Map<string, number>();
  for (const d of days) monthlyMap.set(d.slice(0, 7), (monthlyMap.get(d.slice(0, 7)) ?? 0) + byDay.get(d)!.length);

  return {
    totals: {
      visits: visits.length,
      done: visits.filter((v) => v.outcome === "done").length,
      identified: visits.filter((v) => v.outcome === "unknown").length,
      pharmacies: perPharmacyMap.size,
      days: days.length,
      firstDay: days[0] ?? null,
      lastDay: days.at(-1) ?? null,
      avgVisitsPerDay: days.length ? visits.length / days.length : null,
    },
    perPharmacy,
    weekdays,
    sectorsByWeekday,
    durations: {
      averageMin: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      medianMin: median,
      measured: durations.length,
    },
    farDays,
    mileage,
    clusters,
    monthly: [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, n]) => ({ month, visits: n })),
  };
}
