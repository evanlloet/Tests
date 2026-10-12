import { DUE_STATE_LABELS, type VisitStatus } from "@/domain/frequency";
import { diffDays, formatDayShort } from "@/domain/time";
import { DUE_TONE } from "./labels";
import { Badge } from "./ui/badge";

export function DueBadge({ status }: { status: VisitStatus }) {
  let detail = "";
  if (status.dueState === "overdue" && status.daysUntilDue !== null) detail = ` · ${-status.daysUntilDue} j`;
  if (status.dueState === "due_soon" && status.nextDue) detail = ` · ${formatDayShort(status.nextDue)}`;
  if (status.dueState === "planned" && status.nextPlanned) detail = ` · ${formatDayShort(status.nextPlanned)}`;
  return (
    <Badge tone={status.plannedLate ? "warning" : DUE_TONE[status.dueState]} title={status.plannedLate ? "Le prochain rendez-vous dépasse l'échéance cible" : undefined}>
      {DUE_STATE_LABELS[status.dueState]}
      {detail}
    </Badge>
  );
}

export function YearProgress({ status }: { status: VisitStatus }) {
  const { done, identified, planned, target } = status.year;
  if (target === null) return <span className="text-xs text-muted">Objectif non défini</span>;
  const pct = (n: number) => `${Math.min(100, (n / target) * 100)}%`;
  return (
    <div className="min-w-28" aria-label={`${done} réalisée(s), ${identified} identifiée(s), ${planned} planifiée(s) sur ${target}`}>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
        <span className="bg-success" style={{ width: pct(done) }} />
        <span className="bg-success/45" style={{ width: pct(identified) }} />
        <span className="bg-info/50" style={{ width: pct(planned) }} />
      </div>
      <p className="mt-1 text-xs text-muted tabular-nums">
        {done + identified}/{target} cette année{planned ? ` · ${planned} prévue${planned > 1 ? "s" : ""}` : ""}
      </p>
    </div>
  );
}

export function LastVisit({ status, today }: { status: VisitStatus; today: string }) {
  if (!status.lastVisit) return <span className="text-muted">Aucune visite connue</span>;
  const days = diffDays(status.lastVisit.day, today);
  return (
    <span>
      {formatDayShort(status.lastVisit.day)} <span className="text-muted">(il y a {days} j{status.lastVisit.state === "identified" ? ", non confirmée" : ""})</span>
    </span>
  );
}
