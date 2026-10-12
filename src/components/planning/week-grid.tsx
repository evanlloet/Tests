"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDayShort, formatHHmm } from "@/domain/time";
import { cn } from "@/lib/cn";
import { moveAppointmentAction } from "@/server/actions/appointments";
import type { PlanningDay, PlanningAppointment } from "@/server/services/planning";
import { Notice } from "../ui/notice";

const HOUR_START = 7;
const HOUR_END = 20;
const PX_PER_MIN = 0.9;
const SNAP = 15;

const statusStyle: Record<PlanningAppointment["status"], string> = {
  confirmed: "border-solid",
  pending: "border-dashed",
  proposed: "border-dashed opacity-90",
  cancelled: "opacity-50 line-through",
};

export const LOAD_STYLE: Record<PlanningDay["load"], string> = {
  vide: "text-muted",
  légère: "text-success",
  équilibrée: "text-success",
  chargée: "text-warning",
  "trop chargée": "text-danger font-semibold",
};

export function AppointmentChip({ a, compact = false }: { a: PlanningAppointment; compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-xs font-semibold">{a.title}</span>
      {!compact ? (
        <span className="truncate text-[11px] opacity-80">
          {formatHHmm(a.start)}–{formatHHmm(a.end)}
          {a.pharmacy?.city ? ` · ${a.pharmacy.city}` : ""}
        </span>
      ) : null}
    </span>
  );
}

function blockClasses(a: PlanningAppointment) {
  if (a.kind === "unavailable") return "bg-surface-2 text-muted border-border";
  if (a.kind === "other") return "bg-info-soft text-info border-info/40";
  return "bg-surface text-text";
}

/** Grille hebdomadaire (ordinateur) avec glisser-déposer des rendez-vous. */
export function WeekGrid({ days }: { days: PlanningDay[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [dragging, setDragging] = useState<PlanningAppointment | null>(null);
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const height = (HOUR_END - HOUR_START) * 60 * PX_PER_MIN;

  function onDrop(day: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const a = dragging;
    setDragging(null);
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top - Number(e.dataTransfer.getData("text/offset") || 0);
    const minutes = Math.round((HOUR_START * 60 + offsetY / PX_PER_MIN) / SNAP) * SNAP;
    const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - (a.end - a.start), minutes));
    const start = formatHHmm(clamped);
    let confirm = false;
    if (a.status === "confirmed") {
      confirm = window.confirm(`« ${a.title} » est un rendez-vous confirmé. Le déplacer au ${formatDayShort(day)} à ${start} ? Pensez à prévenir le pharmacien.`);
      if (!confirm) return;
    }
    startTransition(async () => {
      const res = await moveAppointmentAction({ id: a.id, day, start, confirm });
      setMessage(res.ok ? { tone: "success", text: res.message ?? "Déplacé." } : { tone: "danger", text: res.error });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className={cn("overflow-x-auto rounded-2xl border border-border bg-surface", pending && "opacity-70")} aria-busy={pending}>
        <div className="grid min-w-[880px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="border-b border-border" />
          {days.map((d) => (
            <div key={d.day} className={cn("border-b border-l border-border p-2", d.weekday > 5 && "bg-surface-2/60")}>
              <Link href={`/planning?vue=jour&date=${d.day}`} className="block text-sm font-semibold capitalize hover:underline">
                {formatDayShort(d.day)}
              </Link>
              <div className="mt-1 flex flex-wrap gap-1">
                {d.sectors.map((s) => (
                  <span key={s.code} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: s.color }}>
                    {s.name}
                  </span>
                ))}
                {d.holiday ? <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">{d.holiday}</span> : null}
              </div>
              <p className={cn("mt-1 text-[11px]", LOAD_STYLE[d.load])}>
                {d.visits} visite(s){d.driveMinutes !== null ? ` · ~${Math.round(d.driveMinutes / 6) / 10} h de route` : ""}
              </p>
              {d.warnings.length ? (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-danger" title={d.warnings.join("\n")}>
                  <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden /> {d.warnings[0]}
                </p>
              ) : null}
            </div>
          ))}
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted" style={{ top: (h - HOUR_START) * 60 * PX_PER_MIN }}>
                {h} h
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d.day}
              className={cn("relative border-l border-border", d.weekday > 5 && "bg-surface-2/60", dragging && "bg-primary-soft/30")}
              style={{ height }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(d.day, e)}
              aria-label={`Colonne du ${formatDayShort(d.day)}`}
            >
              {hours.map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: (h - HOUR_START) * 60 * PX_PER_MIN }} />
              ))}
              {d.appointments.map((a) => {
                const top = Math.max(0, (a.start - HOUR_START * 60) * PX_PER_MIN);
                const h = Math.max(22, (a.end - a.start) * PX_PER_MIN);
                return (
                  <Link
                    key={a.id}
                    href={`/planning/rdv/${a.id}`}
                    draggable={a.status !== "cancelled"}
                    onDragStart={(e) => {
                      setDragging(a);
                      e.dataTransfer.setData("text/offset", String(e.clientY - e.currentTarget.getBoundingClientRect().top));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "absolute inset-x-1 overflow-hidden rounded-lg border border-l-4 px-1.5 py-1 shadow-card transition-shadow hover:z-10 hover:shadow-lg",
                      blockClasses(a),
                      statusStyle[a.status],
                      a.overlaps && "ring-2 ring-danger/70",
                      a.outcome === "done" && "opacity-75",
                    )}
                    style={{ top, height: h, borderLeftColor: a.color ?? "var(--muted)" }}
                    title={`${a.title} — ${formatHHmm(a.start)}–${formatHHmm(a.end)}`}
                  >
                    <AppointmentChip a={a} compact={h < 36} />
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        Glissez-déposez un rendez-vous pour le déplacer (pas de 15 min). Un rendez-vous confirmé demande une confirmation. Bordure
        pleine : confirmé · pointillés : en attente ou proposé · encadré rouge : chevauchement.
      </p>
    </div>
  );
}
