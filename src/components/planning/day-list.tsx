import { AlertTriangle, Car, Check } from "lucide-react";
import Link from "next/link";
import { APPOINTMENT_STATUS } from "@/components/labels";
import { DayBuddy } from "@/components/mood-ui";
import { Badge, CategoryBadge } from "@/components/ui/badge";
import { formatDayLong, formatDuration, formatHHmm } from "@/domain/time";
import { cn } from "@/lib/cn";
import type { PlanningDay } from "@/server/services/planning";

/** Liste des rendez-vous d'une journée (mobile et vue jour), avec le bonhomme du jour. */
export function DayList({ day, showHeader = true }: { day: PlanningDay; showHeader?: boolean }) {
  return (
    <section aria-labelledby={`day-${day.day}`} className="space-y-3">
      {showHeader ? (
        <header className="flex items-center gap-3">
          <DayBuddy mood={day.mood} size={44} />
          <div className="min-w-0 flex-1">
            <h2 id={`day-${day.day}`} className="text-lg leading-tight font-bold capitalize">
              <Link href={`/planning?vue=jour&date=${day.day}`} className="hover:underline">
                {formatDayLong(day.day)}
              </Link>
            </h2>
            <p className="text-xs text-muted">
              {day.mood.label} · {day.visits} visite(s){day.allClosed ? " · tout est clôturé" : ""}
            </p>
          </div>
        </header>
      ) : null}
      {day.sectors.length || day.holiday ? (
        <div className="flex flex-wrap gap-1.5">
          {day.sectors.map((s) => (
            <span key={s.code} className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: s.color }}>
              {s.name}
            </span>
          ))}
          {day.holiday ? <Badge tone="warning">{day.holiday}</Badge> : null}
        </div>
      ) : null}
      {day.warnings.map((w) => (
        <p key={w} className="flex items-center gap-2 rounded-2xl bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {w}
        </p>
      ))}
      {day.appointments.length === 0 ? (
        <p className="rounded-[20px] border-2 border-dashed border-border px-4 py-4 text-sm text-muted">Aucun rendez-vous.</p>
      ) : (
        <ol className="space-y-2">
          {day.appointments.map((a, i) => {
            const prev = day.appointments[i - 1];
            const gap = prev ? a.start - prev.end : null;
            const done = a.outcome === "done";
            return (
              <li key={a.id}>
                {gap !== null && gap > 0 ? (
                  <p className="flex items-center gap-1.5 py-1 pl-4 text-xs text-muted">
                    <Car className="size-3.5" aria-hidden /> {formatDuration(gap)} entre les deux rendez-vous
                  </p>
                ) : null}
                <Link
                  href={`/planning/rdv/${a.id}`}
                  className={cn(
                    "flex items-center gap-3 rounded-[20px] border-2 bg-surface px-3 py-2.5 transition hover:-translate-y-0.5 hover:shadow-card",
                    a.status === "proposed" || a.status === "pending" ? "border-dashed border-border" : "border-transparent",
                    a.overlaps && "border-danger/60",
                    done && "opacity-80",
                  )}
                >
                  <span
                    className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-text"
                    style={{ backgroundColor: a.color ? `color-mix(in srgb, ${a.color} 22%, var(--surface))` : "var(--surface-2)" }}
                  >
                    <span className="font-display text-sm font-extrabold">{formatHHmm(a.start)}</span>
                    <span className="text-[10px] opacity-70">{formatHHmm(a.end)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("truncate font-semibold", done && "line-through decoration-2")}>{a.title}</span>
                      {a.kind === "visit" ? <CategoryBadge category={a.category} /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">{a.pharmacy?.city ?? (a.kind === "unavailable" ? "Indisponible" : "")}</span>
                  </span>
                  {done ? (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mint text-on-pastel" title="Visite réalisée">
                      <Check className="size-4" aria-hidden />
                    </span>
                  ) : (
                    <Badge tone={APPOINTMENT_STATUS[a.status].tone} className="shrink-0">
                      {APPOINTMENT_STATUS[a.status].label}
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {day.driveMinutes !== null && day.visits > 0 ? (
        <p className="text-xs text-muted">
          Trajets estimés (domicile → visites → domicile, à vol d'oiseau) : ~{Math.round(day.driveKm ?? 0)} km, {formatDuration(day.driveMinutes)}.
        </p>
      ) : null}
    </section>
  );
}
