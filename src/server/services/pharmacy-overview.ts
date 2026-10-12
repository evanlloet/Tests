import "server-only";
import {
  computeVisitStatusFromSummary,
  targetVisitsPerYear,
  type DueState,
  type VisitStatus,
  type VisitSummary,
} from "@/domain/frequency";
import { dayKeyOf } from "@/domain/time";
import type { SessionUser } from "../auth/session";
import { db } from "../db/client";
import type { Pharmacy, PharmacyMetrics } from "../db/schema";
import { listPharmaciesWithMetrics, visitAggregates, type PharmacyFilters, type VisitAggregate } from "../repositories/pharmacies";
import { territoryLookup } from "../repositories/territories";
import { frequencySettings, todayFor, yearBounds } from "./context";

export type PharmacyOverviewItem = {
  pharmacy: Pharmacy;
  metrics: PharmacyMetrics | null;
  status: VisitStatus;
  territory: { name: string; color: string } | null;
  totalVisits: number;
};

export function statusFromAggregate(
  agg: VisitAggregate | undefined,
  perYear: number | null,
  today: string,
  tz: string,
): VisitStatus {
  const lastDone = agg?.lastDone ?? null;
  const lastIdentified = agg?.lastIdentified ?? null;
  let lastVisit: VisitSummary["lastVisit"] = null;
  if (lastDone && (!lastIdentified || lastDone >= lastIdentified)) lastVisit = { day: dayKeyOf(lastDone, tz), state: "done" };
  else if (lastIdentified) lastVisit = { day: dayKeyOf(lastIdentified, tz), state: "identified" };
  return computeVisitStatusFromSummary({
    perYear,
    today,
    summary: {
      lastVisit,
      nextPlanned: agg?.nextPlanned ? dayKeyOf(agg.nextPlanned, tz) : null,
      year: { done: agg?.doneYear ?? 0, identified: agg?.identifiedYear ?? 0, planned: agg?.plannedYear ?? 0 },
    },
  });
}

const DUE_ORDER: Record<DueState, number> = { overdue: 0, never_visited: 1, due_soon: 2, planned: 3, ok: 4, unknown: 5 };

export async function getPharmacyOverview(
  user: SessionUser,
  filters: PharmacyFilters & { due?: DueState | "all"; sort?: "name" | "urgency" } = {},
): Promise<PharmacyOverviewItem[]> {
  const now = new Date();
  const today = todayFor(user, now);
  const { yearStart, nextYearStart } = yearBounds(today, user.timezone);
  const rows = await listPharmaciesWithMetrics(db, user.id, filters);
  const aggregates = await visitAggregates(
    db,
    user.id,
    now,
    yearStart,
    nextYearStart,
    filters.ids ?? (rows.length < 500 ? rows.map((r) => r.pharmacy.id) : undefined),
  );
  const territories = await territoryLookup(db, user.id);
  const freq = frequencySettings(user);

  let items = rows.map(({ pharmacy, metrics }) => {
    const target = targetVisitsPerYear(metrics?.category ?? null, metrics?.targetVisitsPerYear ?? null, freq);
    const agg = aggregates.get(pharmacy.id);
    return {
      pharmacy,
      metrics,
      status: statusFromAggregate(agg, target.perYear, today, user.timezone),
      territory: pharmacy.departmentCode ? (territories.get(pharmacy.departmentCode) ?? null) : null,
      totalVisits: agg?.total ?? 0,
    };
  });
  if (filters.due && filters.due !== "all") items = items.filter((i) => i.status.dueState === filters.due);
  if (filters.sort === "urgency") {
    items.sort(
      (a, b) =>
        DUE_ORDER[a.status.dueState] - DUE_ORDER[b.status.dueState] ||
        (a.status.daysUntilDue ?? 9999) - (b.status.daysUntilDue ?? 9999) ||
        a.pharmacy.name.localeCompare(b.pharmacy.name, "fr"),
    );
  }
  return items;
}
