import { AlertTriangle, Car } from "lucide-react";
import Link from "next/link";
import { APPOINTMENT_STATUS } from "@/components/labels";
import { Badge, CategoryBadge } from "@/components/ui/badge";
import { formatDayLong, formatDuration, formatHHmm } from "@/domain/time";
import { cn } from "@/lib/cn";
import type { PlanningDay } from "@/server/services/planning";
import { LOAD_STYLE } from "./week-grid";

/** Liste des rendez-vous d'une journée (mobile et vue jour). */
export function DayList({ day, showHeader = true }: { day: PlanningDay; showHeader?: boolean }) {
  return (
    <section aria-labelledby={`day-${day.day}`} className="space-y-2">
      {showHeader ? (
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`day-${day.day}`} className="font-semibold capitalize">
            <Link href={`/planning?vue=jour&date=${day.day}`} className="hover:underline">
              {formatDayLong(day.day)}
            </Link>
          </h2>
          <span className={cn("text-xs", LOAD_STYLE[day.load])}>
            {day.visits} visite(s) · charge {day.load}
          </span>
        </header>
      ) : null}
      {day.sectors.length || day.holiday ? (
        <div className="flex flex-wrap gap-1">
          {day.sectors.map((s) => (
            <span key={s.code} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: s.color }}>
              {s.name}
            </span>
          ))}
          {day.holiday ? <Badge tone="warning">{day.holiday}</Badge> : null}
        </div>
      ) : null}
      {day.warnings.map((w) => (
        <p key={w} className="flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="size-4" aria-hidden /> {w}
        </p>
      ))}
      {day.appointments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted">Aucun rendez-vous.</p>
      ) : (
        <ol className="space-y-2">
          {day.appointments.map((a, i) => {
            const prev = day.appointments[i - 1];
            const gap = prev ? a.start - prev.end : null;
            return (
              <li key={a.id}>
                {gap !== null && gap > 0 ? (
                  <p className="flex items-center gap-1.5 py-1 pl-3 text-xs text-muted">
                    <Car className="size-3.5" aria-hidden /> {formatDuration(gap)} entre les deux rendez-vous
                  </p>
                ) : null}
                <Link
                  href={`/planning/rdv/${a.id}`}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-l-4 border-border bg-surface px-3 py-2.5 shadow-card hover:bg-surface-2",
                    a.status === "proposed" || a.status === "pending" ? "border-dashed" : "",
                    a.overlaps && "ring-2 ring-danger/60",
                  )}
                  style={{ borderLeftColor: a.color ?? "var(--muted)" }}
                >
                  <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{formatHHmm(a.start)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{a.title}</span>
                      {a.kind === "visit" ? <CategoryBadge category={a.category} /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {formatHHmm(a.start)}–{formatHHmm(a.end)}
                      {a.pharmacy?.city ? ` · ${a.pharmacy.city}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={APPOINTMENT_STATUS[a.status].tone}>{APPOINTMENT_STATUS[a.status].label}</Badge>
                    {a.outcome === "done" ? <Badge tone="success">Réalisée</Badge> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {day.driveMinutes !== null && day.visits > 0 ? (
        <p className="text-xs text-muted">
          Trajets estimés (domicile → visites → domicile, vol d&apos;oiseau) : ~{Math.round(day.driveKm ?? 0)} km, {formatDuration(day.driveMinutes)}.
        </p>
      ) : null}
    </section>
  );
}
