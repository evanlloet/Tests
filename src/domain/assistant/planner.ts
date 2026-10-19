/**
 * Plan des prochaines semaines proposé par l'assistant.
 *
 * Pour chaque jour ouvré à venir (hors fériés, congés, télétravail) :
 *  1. secteur : s'il y a déjà des rendez-vous, c'est leur secteur ; sinon le secteur
 *     qui combine le mieux l'habitude de ce jour de la semaine (agenda passé + semaine
 *     type), le besoin (clientes dues dans le secteur) et les retours de l'utilisatrice ;
 *  2. clientes : la plus prioritaire (catégorie × retard) sert d'ancre, puis ses
 *     voisines dues, jusqu'au nombre habituel de visites ; horaires indicatifs à partir
 *     de l'heure de début habituelle, de la durée habituelle et des trajets estimés ;
 *  3. hôtel : entre deux journées lointaines consécutives, un soir où elle dort
 *     habituellement à l'hôtel, nuit proposée dans l'hôtel habituel du secteur du
 *     lendemain.
 * Le calcul est déterministe : mêmes données, même plan.
 */
import { departmentName } from "../departments";
import { categoryWeight, intervalDays, type Category } from "../frequency";
import { haversineKm, type LatLng } from "../geo";
import { DEFAULT_ESTIMATE, estimateLeg, type EstimateParams } from "../routing/estimate";
import { addDays, diffDays, isoWeekday, startOfIsoWeek, type DayKey } from "../time";
import type { Habits, Learning } from "./learning";

export type PlannerClient = {
  id: string;
  name: string;
  city: string | null;
  departmentCode: string | null;
  category: Category | null;
  location: LatLng | null;
  perYear: number | null;
  lastOnsite: DayKey | null;
  /** Date de prochaine visite indiquée dans le fichier clients */
  fileNextVisit: DayKey | null;
};

export type ExistingAppointment = {
  id: string;
  day: DayKey;
  /** Minutes depuis minuit (heure locale) */
  start: number;
  end: number;
  pharmacyId: string | null;
  title: string;
  departmentCode: string | null;
  location: LatLng | null;
  kind: "visit" | "unavailable" | "other";
  mode: "onsite" | "phone";
};

export type PlannerInput = {
  today: DayKey;
  horizonDays: number;
  clients: PlannerClient[];
  existing: ExistingAppointment[];
  /** Jours sans terrain : fériés, congés, télétravail… avec la raison */
  blockedDays: Map<DayKey, string>;
  habits: Habits;
  learning: Learning;
  home: LatLng | null;
  hotelThresholdKm: number;
  /** Nuits déjà réservées dans l'agenda (soir → hôtel) */
  bookedNights?: Map<DayKey, { name: string; city: string | null }>;
  estimate?: EstimateParams;
};

export type ProposedVisit = {
  pharmacyId: string;
  name: string;
  city: string | null;
  departmentCode: string | null;
  category: Category | null;
  start: number;
  end: number;
  why: string;
  overdueDays: number;
};

export type PlannedDay = {
  day: DayKey;
  weekday: number;
  status: "blocked" | "full" | "proposed" | "empty";
  blockedReason: string | null;
  sectors: string[];
  why: string[];
  existing: ExistingAppointment[];
  proposals: ProposedVisit[];
  /** Nuit d'hôtel conseillée ce soir-là */
  hotel: { name: string; city: string | null; why: string; booked: boolean } | null;
  startsFromHotel: boolean;
  kmEstimate: number | null;
};

export type Recommendation = {
  id: string;
  tone: "danger" | "warning" | "info" | "success";
  title: string;
  detail: string;
  /** Lien éventuel vers l'écran concerné */
  href?: string;
  items?: { label: string; href?: string; hint?: string }[];
};

type Assigned = Map<string, DayKey[]>;

const DUE_WINDOW_DAYS = 14;
const CLUSTER_RADIUS_KM = 40;

export function interval(client: PlannerClient): number {
  return intervalDays(client.perYear && client.perYear > 0 ? client.perYear : 3);
}

/** Date de la dernière visite connue avant `day` (passée, déjà planifiée ou proposée). */
function lastBefore(client: PlannerClient, day: DayKey, existingDays: DayKey[], assigned: DayKey[]): DayKey | null {
  let last = client.lastOnsite;
  for (const d of [...existingDays, ...assigned]) if (d <= day && (!last || d > last)) last = d;
  return last;
}

export function buildPlan(input: PlannerInput) {
  const estimate = input.estimate ?? DEFAULT_ESTIMATE;
  const { habits, learning } = input;
  const byDay = new Map<DayKey, ExistingAppointment[]>();
  for (const a of input.existing) byDay.set(a.day, [...(byDay.get(a.day) ?? []), a]);
  const existingDaysByClient = new Map<string, DayKey[]>();
  for (const a of input.existing) if (a.pharmacyId && a.kind === "visit") existingDaysByClient.set(a.pharmacyId, [...(existingDaysByClient.get(a.pharmacyId) ?? []), a.day]);
  const located = input.clients.filter((c) => c.location);
  const clientById = new Map(input.clients.map((c) => [c.id, c]));
  const assigned: Assigned = new Map();
  const days: PlannedDay[] = [];

  /** Priorité d'une cliente pour un jour donné, ou null si elle n'est pas due. */
  const priority = (c: PlannerClient, day: DayKey) => {
    if (learning.clientSnoozedUntil.get(c.id) && learning.clientSnoozedUntil.get(c.id)! > day) return null;
    if (learning.clientAvoidWeekdays.get(c.id)?.has(isoWeekday(day))) return null;
    const iv = interval(c);
    const existingDays = existingDaysByClient.get(c.id) ?? [];
    // Déjà un rendez-vous (ou une proposition) proche dans le temps : rien à proposer
    const near = [...existingDays, ...(assigned.get(c.id) ?? [])].some((d) => Math.abs(diffDays(d, day)) < iv * 0.6);
    if (near) return null;
    const last = lastBefore(c, day, existingDays, assigned.get(c.id) ?? []);
    const due = last ? addDays(last, iv) : input.today;
    if (diffDays(day, due) > DUE_WINDOW_DAYS) return null;
    const overdue = last ? diffDays(due, day) : iv;
    let p = categoryWeight(c.category) * (1 + Math.max(-0.5, Math.min(2, overdue / iv)));
    if (c.fileNextVisit && Math.abs(diffDays(c.fileNextVisit, day)) <= 7) p += 0.6;
    return { p, overdue, never: !last };
  };

  let previous: PlannedDay | null = null;
  const weekSectorCount = new Map<string, number>();
  for (let i = 1; i <= input.horizonDays; i++) {
    const day = addDays(input.today, i);
    const wd = isoWeekday(day);
    if (wd > 5) continue;
    if (wd === 1) weekSectorCount.clear();
    const existing = (byDay.get(day) ?? []).sort((a, b) => a.start - b.start);
    const base: PlannedDay = { day, weekday: wd, status: "empty", blockedReason: null, sectors: [], why: [], existing, proposals: [], hotel: null, startsFromHotel: false, kmEstimate: null };
    const blocked = input.blockedDays.get(day) ?? (existing.some((a) => a.kind === "unavailable" && a.end - a.start >= 6 * 60) ? "Indisponible" : null);
    if (blocked) {
      days.push({ ...base, status: "blocked", blockedReason: blocked });
      previous = null;
      continue;
    }
    const onsiteExisting = existing.filter((a) => a.kind === "visit" && a.mode === "onsite");
    const capacity = Math.max(2, Math.round(habits.visitsPerDay[wd]! + learning.capacityDelta));
    if (learning.avoidWeekdays.has(wd) && onsiteExisting.length === 0) {
      days.push({ ...base, why: ["Vous m'avez indiqué que ce jour n'est souvent pas un jour de terrain."] });
      previous = null;
      continue;
    }

    // --- Clientes dues ce jour-là
    const pool = located
      .map((c) => ({ c, pr: priority(c, day) }))
      .filter((x): x is { c: PlannerClient; pr: NonNullable<ReturnType<typeof priority>> } => x.pr !== null)
      .filter((x) => !onsiteExisting.some((a) => a.pharmacyId === x.c.id));
    const room = capacity - onsiteExisting.length;

    /** Remplit la journée dans les secteurs donnés : ancre = cliente due au cœur du groupe le plus dense, puis ses voisines. */
    const fill = (sectors: string[]) => {
      const chosen: typeof pool = [];
      if (room <= 0) return chosen;
      const centre = () => {
        const pts = [...onsiteExisting.filter((a) => a.location).map((a) => a.location!), ...chosen.map((x) => x.c.location!)];
        if (!pts.length) return null;
        return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
      };
      if (!centre()) {
        const inSector = pool.filter((x) => x.c.departmentCode && sectors.includes(x.c.departmentCode));
        let anchor: { x: (typeof pool)[number]; s: number } | null = null;
        for (const x of inSector) {
          const s = x.pr.p + 0.5 * inSector.reduce((n, o) => (o !== x && haversineKm(o.c.location!, x.c.location!) <= 25 ? n + o.pr.p : n), 0);
          if (!anchor || s > anchor.s || (s === anchor.s && x.c.id < anchor.x.c.id)) anchor = { x, s };
        }
        if (anchor) chosen.push(anchor.x);
      }
      while (chosen.length < room) {
        const c0 = centre();
        if (!c0) break;
        let pick: { x: (typeof pool)[number]; s: number } | null = null;
        for (const x of pool) {
          if (chosen.includes(x)) continue;
          const d = haversineKm(c0, x.c.location!);
          const sameSector = x.c.departmentCode && sectors.includes(x.c.departmentCode);
          if (d > (sameSector ? CLUSTER_RADIUS_KM : 20)) continue;
          const sc = x.pr.p - d / 30;
          if (!pick || sc > pick.s || (sc === pick.s && x.c.id < pick.x.c.id)) pick = { x, s: sc };
        }
        if (!pick) break;
        chosen.push(pick.x);
      }
      return chosen;
    };

    // --- Secteur du jour
    let sectors: string[];
    let chosen: typeof pool;
    const why: string[] = [];
    const existingDeps = onsiteExisting.map((a) => a.departmentCode).filter((c): c is string => Boolean(c));
    if (existingDeps.length) {
      const counts = new Map<string, number>();
      for (const c of existingDeps) counts.set(c, (counts.get(c) ?? 0) + 1);
      sectors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 2);
      chosen = fill(sectors);
      why.push(`${onsiteExisting.length} rendez-vous déjà prévu(s) : je complète la journée autour.`);
    } else {
      const need = new Map<string, number>();
      for (const x of pool) if (x.c.departmentCode) need.set(x.c.departmentCode, (need.get(x.c.departmentCode) ?? 0) + x.pr.p);
      const maxNeed = Math.max(0.0001, ...need.values());
      const share = habits.sectorShare[wd] ?? {};
      const habitual = [...need.keys()].filter((dep) => (share[dep] ?? 0) >= 0.1);
      const candidates = habitual.length ? habitual : [...need.keys()];
      const ranked = candidates
        .map((dep) => {
          const habit = share[dep] ?? 0.02;
          const n = (need.get(dep) ?? 0) / maxNeed;
          const factor = learning.sectorFactor[wd]?.[dep] ?? 1;
          let score = (0.7 * habit + 0.3 * n) * factor;
          // Ne pas enchaîner trop de journées dans le même secteur, sauf habitude marquée
          if ((weekSectorCount.get(dep) ?? 0) >= 2 && habit < 0.5) score *= 0.5;
          // Après une nuit à l'hôtel, on reste dans la région
          if (previous?.hotel && previous.sectors.includes(dep)) score *= 1.3;
          return { dep, score, habit, need: n, factor };
        })
        .sort((a, b) => b.score - a.score || a.dep.localeCompare(b.dep))
        .slice(0, 4);
      // On garde le secteur qui donne la journée la plus utile (habitude × journée bien remplie)
      let best: { r: (typeof ranked)[number]; chosen: typeof pool; value: number } | null = null;
      for (const r of ranked) {
        const c = fill([r.dep]);
        const value = r.score * Math.min(1, c.length / Math.max(1, room)) ** 1.5;
        if (c.length && (!best || value > best.value)) best = { r, chosen: c, value };
      }
      if (!best) {
        days.push({ ...base, why: ["Aucune cliente à voir ce jour-là : journée libre pour l'administratif ou la prospection."] });
        previous = null;
        continue;
      }
      sectors = [best.r.dep];
      chosen = best.chosen;
      if (best.r.habit >= 0.25) why.push(`Habitude : ${Math.round(best.r.habit * 100)} % de vos ${weekdayName(wd)}s.`);
      if (best.r.need >= 0.6) why.push("Beaucoup de clientes à voir dans ce secteur.");
      if (best.r.factor >= 1.2) why.push("Vous avez déjà accepté ce secteur ce jour-là.");
      if (chosen.length < room) why.push(`Seulement ${chosen.length} cliente(s) due(s) à proximité : place pour de la prospection.`);
    }
    // Deuxième secteur si les clientes retenues débordent sur un département voisin
    for (const x of chosen) if (x.c.departmentCode && !sectors.includes(x.c.departmentCode) && sectors.length < 2) sectors.push(x.c.departmentCode);

    // --- Ordre et horaires indicatifs
    const startPoint = previous?.hotel ? (habits.hotels[previous.sectors[0] ?? ""]?.location ?? input.home) : input.home;
    const ordered: typeof chosen = [];
    let pos = startPoint ?? chosen[0]?.c.location ?? null;
    const rest = [...chosen];
    while (rest.length) {
      rest.sort((a, b) => (pos ? haversineKm(pos, a.c.location!) - haversineKm(pos, b.c.location!) : 0) || a.c.id.localeCompare(b.c.id));
      const next = rest.shift()!;
      ordered.push(next);
      pos = next.c.location!;
    }
    const busy = existing.map((a) => [a.start, a.end] as [number, number]);
    const proposals: ProposedVisit[] = [];
    let t = habits.startMinutes[wd]!;
    let last: LatLng | null = startPoint;
    let lunch = false;
    for (const x of ordered) {
      const travel = last ? Math.ceil(estimateLeg(last, x.c.location!, estimate).minutes / 15) * 15 : 0;
      let start = proposals.length || onsiteExisting.length ? t + travel : t;
      if (!lunch && start >= 12 * 60) {
        start = Math.max(start, 13 * 60 + 30);
        lunch = true;
      }
      // Évite les rendez-vous déjà posés
      for (const [s, e] of busy) if (start < e && start + habits.visitMinutes > s) start = Math.ceil(e / 15) * 15 + travel;
      if (start + habits.visitMinutes > habits.endMinutes[wd]! + 30) continue;
      const iv = interval(x.c);
      proposals.push({
        pharmacyId: x.c.id,
        name: x.c.name,
        city: x.c.city,
        departmentCode: x.c.departmentCode,
        category: x.c.category,
        start,
        end: start + habits.visitMinutes,
        overdueDays: x.pr.overdue,
        why: x.pr.never
          ? "Jamais vue sur place"
          : x.c.fileNextVisit && Math.abs(diffDays(x.c.fileNextVisit, day)) <= 7
            ? "Date de prochaine visite du fichier clients"
            : x.pr.overdue > 0
              ? `En retard de ${x.pr.overdue} j (une visite tous les ${iv} j)`
              : `À voir d'ici ${-x.pr.overdue} j`,
      });
      busy.push([start, start + habits.visitMinutes]);
      t = start + habits.visitMinutes;
      last = x.c.location!;
    }
    for (const p of proposals) assigned.set(p.pharmacyId, [...(assigned.get(p.pharmacyId) ?? []), day]);
    for (const s of sectors) weekSectorCount.set(s, (weekSectorCount.get(s) ?? 0) + 1);

    const stops = [...onsiteExisting.filter((a) => a.location).map((a) => a.location!), ...proposals.map((p) => clientById.get(p.pharmacyId)!.location!)];
    let km: number | null = null;
    if (input.home && startPoint && stops.length) {
      km = 0;
      let p = startPoint;
      for (const s of stops) {
        km += estimateLeg(p, s, estimate).km;
        p = s;
      }
      km += estimateLeg(p, input.home, estimate).km;
    }
    const planned: PlannedDay = {
      ...base,
      status: proposals.length ? "proposed" : onsiteExisting.length >= capacity ? "full" : "empty",
      sectors,
      why: proposals.length || onsiteExisting.length ? why : [...why, "Aucune cliente due dans ce secteur."],
      proposals,
      startsFromHotel: Boolean(previous?.hotel),
      kmEstimate: km,
    };

    const booked = input.bookedNights?.get(day);
    if (booked) planned.hotel = { name: booked.name, city: booked.city, why: "Déjà réservé dans votre agenda.", booked: true };
    if (previous?.hotel?.booked) planned.startsFromHotel = true;

    // --- Hôtel la veille ? (décidé maintenant qu'on connaît le secteur du jour)
    if (previous && input.home && previous.weekday === wd - 1 && !previous.hotel) {
      const far = (d: PlannedDay) => {
        const pts = [...d.existing.filter((a) => a.kind === "visit" && a.mode === "onsite" && a.location).map((a) => a.location!), ...d.proposals.map((p) => clientById.get(p.pharmacyId)!.location!)];
        return pts.length ? Math.max(...pts.map((p) => haversineKm(input.home!, p) * estimate.roadFactor)) : 0;
      };
      const habitHotel = (habits.hotelShare[previous.weekday] ?? 0) >= 0.2;
      if (far(previous) >= input.hotelThresholdKm && far(planned) >= input.hotelThresholdKm && (habitHotel || habits.daysAnalysed < 20)) {
        const dep = planned.sectors[0] ?? previous.sectors[0] ?? "";
        const h = habits.hotels[dep] ?? habits.hotels[previous.sectors[0] ?? ""];
        previous.hotel = {
          name: h?.name ?? "Hôtel à choisir",
          city: h?.city ?? null,
          booked: false,
          why: `Deux journées loin du domicile d'affilée${habitHotel ? `, et vous dormez souvent à l'hôtel le ${weekdayName(previous.weekday)} soir` : ""}${h ? ` ; votre hôtel habituel dans ce secteur (${h.nights} nuit(s))` : ""}.`,
        };
        planned.startsFromHotel = true;
      }
    }
    days.push(planned);
    previous = planned;
  }

  return { days, recommendations: buildRecommendations(input, days, assigned) };
}

function buildRecommendations(input: PlannerInput, days: PlannedDay[], assigned: Assigned): Recommendation[] {
  const recs: Recommendation[] = [];
  const horizonEnd = addDays(input.today, input.horizonDays);
  const plannedSoon = new Set<string>();
  for (const a of input.existing) if (a.pharmacyId && a.kind === "visit") plannedSoon.add(a.pharmacyId);

  // 1. Clientes importantes en retard, ni planifiées ni placées
  const overdue = input.clients.filter((c) => {
    if (c.category !== "A" && c.category !== "B") return false;
    const due = c.lastOnsite ? addDays(c.lastOnsite, interval(c)) : input.today;
    return due <= input.today && !plannedSoon.has(c.id) && !assigned.has(c.id);
  });
  if (overdue.length) {
    recs.push({
      id: "overdue-unplaced",
      tone: "danger",
      title: `${overdue.length} cliente(s) A/B en retard que je n'arrive pas à placer`,
      detail: "Aucune journée de la période ne tombe dans leur secteur, ou elles sont reportées. Prévoyez un passage ou un appel.",
      items: overdue.slice(0, 10).map((c) => ({ label: `${c.name} (${c.city ?? "?"}, cat. ${c.category})`, href: `/pharmacies/${c.id}`, hint: c.lastOnsite ? `vue le ${c.lastOnsite}` : "jamais vue" })),
    });
  }
  const placedOverdue = [...assigned.keys()].filter((id) => {
    const c = input.clients.find((x) => x.id === id);
    if (!c) return false;
    return !c.lastOnsite || addDays(c.lastOnsite, interval(c)) <= input.today;
  });
  if (placedOverdue.length) {
    recs.push({
      id: "overdue-placed",
      tone: "success",
      title: `${placedOverdue.length} cliente(s) en retard replacée(s) dans le plan`,
      detail: "Elles sont réparties dans les journées ci-dessous, en commençant par les catégories A et B.",
    });
  }

  // 2. Nuits d'hôtel à réserver
  const hotels = days.filter((d) => d.hotel && !d.hotel.booked);
  if (hotels.length) {
    recs.push({
      id: "hotels",
      tone: "info",
      title: `${hotels.length} nuit(s) d'hôtel à prévoir`,
      detail: "Deux journées lointaines d'affilée : dormir sur place évite l'aller-retour.",
      items: hotels.map((d) => ({ label: `${weekdayName(d.weekday)} ${d.day.slice(8)}/${d.day.slice(5, 7)} soir : ${d.hotel!.name}${d.hotel!.city ? ` (${d.hotel!.city})` : ""}` })),
    });
  }

  // 3. Journées entamées à compléter
  const toComplete = days.filter((d) => d.existing.some((a) => a.kind === "visit") && d.proposals.length);
  if (toComplete.length) {
    recs.push({
      id: "complete-days",
      tone: "info",
      title: `${toComplete.length} journée(s) déjà entamée(s) à compléter`,
      detail: "J'ajoute des clientes dues à proximité des rendez-vous existants.",
    });
  }

  // 4. Rendez-vous peut-être trop rapprochés
  const tooSoon = input.existing.filter((a) => {
    if (!a.pharmacyId || a.kind !== "visit") return false;
    const c = input.clients.find((x) => x.id === a.pharmacyId);
    return c?.lastOnsite ? diffDays(c.lastOnsite, a.day) < interval(c) * 0.4 : false;
  });
  if (tooSoon.length) {
    recs.push({
      id: "too-soon",
      tone: "warning",
      title: `${tooSoon.length} rendez-vous peut-être trop rapproché(s) de la visite précédente`,
      detail: "Un appel suffirait peut-être, ou le rendez-vous peut être décalé pour libérer la place.",
      items: tooSoon.slice(0, 8).map((a) => ({ label: `${a.title} — ${a.day}`, href: `/pharmacies/${a.pharmacyId}` })),
    });
  }

  // 5. Équilibre des secteurs : besoin vs journées proposées
  const need = new Map<string, number>();
  for (const c of input.clients) {
    if (!c.departmentCode) continue;
    const due = c.lastOnsite ? addDays(c.lastOnsite, interval(c)) : input.today;
    if (due <= horizonEnd) need.set(c.departmentCode, (need.get(c.departmentCode) ?? 0) + 1);
  }
  const daysBySector = new Map<string, number>();
  for (const d of days) if (d.sectors[0] && (d.proposals.length || d.existing.length)) daysBySector.set(d.sectors[0], (daysBySector.get(d.sectors[0]) ?? 0) + 1);
  const totalNeed = [...need.values()].reduce((s, x) => s + x, 0);
  const totalDays = [...daysBySector.values()].reduce((s, x) => s + x, 0);
  if (totalNeed && totalDays) {
    const gaps = [...need.entries()]
      .map(([dep, n]) => ({ dep, gap: n / totalNeed - (daysBySector.get(dep) ?? 0) / totalDays, n }))
      .filter((g) => g.gap > 0.12 && g.n >= 5);
    for (const g of gaps) {
      recs.push({
        id: `balance-${g.dep}`,
        tone: "warning",
        title: `${departmentName(g.dep)} : peu de journées prévues`,
        detail: `${g.n} clientes à voir d'ici la fin de la période, mais peu de journées y sont prévues. Pensez à y consacrer une journée de plus (ou acceptez une proposition dans ce secteur).`,
      });
    }
  }
  return recs;
}

const WEEKDAY_NAMES = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export function weekdayName(wd: number): string {
  return WEEKDAY_NAMES[wd] ?? "";
}

export function weekOf(day: DayKey): DayKey {
  return startOfIsoWeek(day);
}
