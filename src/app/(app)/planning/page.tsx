import { CalendarPlus, ChevronLeft, ChevronRight, Route } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DayList } from "@/components/planning/day-list";
import { MonthCalendar } from "@/components/planning/month-calendar";
import { WeekGrid } from "@/components/planning/week-grid";
import { LinkButton } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { addDays, formatDayLong, formatDayShort, isDayKey, startOfIsoWeek } from "@/domain/time";
import { assignWeekTemplateAction } from "@/server/actions/profile";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { activeTemplateForWeek } from "@/server/repositories/territories";
import { todayFor } from "@/server/services/context";
import { getPlanning } from "@/server/services/planning";

export const metadata: Metadata = { title: "Planning" };

export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayFor(user);
  const date = sp.date && isDayKey(sp.date) ? sp.date : today;
  const view = sp.vue === "jour" ? "jour" : sp.vue === "mois" ? "mois" : "semaine";
  const weekStart = startOfIsoWeek(date);
  const month = date.slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonthStart = shiftMonth(monthStart, 1);
  const from = view === "jour" ? date : view === "mois" ? startOfIsoWeek(monthStart) : weekStart;
  const to = view === "jour" ? date : view === "mois" ? addDays(startOfIsoWeek(addDays(nextMonthStart, -1)), 6) : addDays(weekStart, 6);
  const days = await getPlanning(db, user, from, to);
  const { templates, active, isOverride } = await activeTemplateForWeek(db, user.id, weekStart);
  const move = (dir: 1 | -1) => (view === "jour" ? addDays(date, dir) : view === "mois" ? shiftMonth(monthStart, dir) : addDays(date, dir * 7));
  const href = (d: string, v: string = view) => `/planning?vue=${v}&date=${d}`;
  const subtitle =
    view === "jour" ? (
      <span className="capitalize">{formatDayLong(date)}</span>
    ) : view === "mois" ? (
      <span className="capitalize">{new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T12:00:00Z`))}</span>
    ) : (
      `Semaine du ${formatDayShort(weekStart)} au ${formatDayShort(addDays(weekStart, 6))}`
    );

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle={subtitle}
        actions={
          <>
            <LinkButton href={`/tournees?date=${date}`} variant="secondary">
              <Route className="size-4" aria-hidden /> Optimiser
            </LinkButton>
            <LinkButton href={`/planning/nouveau?date=${date}`}>
              <CalendarPlus className="size-4" aria-hidden /> Nouveau
            </LinkButton>
          </>
        }
      />
      {sp.ok ? <Notice tone="success" className="mb-4">{sp.ok}</Notice> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-full border border-border bg-surface shadow-card">
          <Link href={href(move(-1))} className="rounded-full p-2.5 hover:bg-surface-2" aria-label="Période précédente">
            <ChevronLeft className="size-5" />
          </Link>
          <Link href={href(today)} className="px-3 text-sm font-semibold hover:underline">
            Aujourd&apos;hui
          </Link>
          <Link href={href(move(1))} className="rounded-full p-2.5 hover:bg-surface-2" aria-label="Période suivante">
            <ChevronRight className="size-5" />
          </Link>
        </div>
        <div className="flex rounded-full border border-border bg-surface p-1 text-sm shadow-card" role="tablist">
          {(["jour", "semaine", "mois"] as const).map((v) => (
            <Link
              key={v}
              href={href(date, v)}
              role="tab"
              aria-selected={view === v}
              className={`rounded-full px-3.5 py-1.5 font-semibold capitalize ${view === v ? "bg-ink text-ink-fg" : "text-muted hover:text-text"}`}
            >
              {v}
            </Link>
          ))}
        </div>
        {templates.length ? (
          <ActionForm action={assignWeekTemplateAction} className="flex w-full flex-wrap items-center gap-2 sm:w-auto" feedback={false}>
            <input type="hidden" name="weekStart" value={weekStart} />
            <label htmlFor="templateId" className="text-sm text-muted">
              Secteurs :
            </label>
            <Select id="templateId" name="templateId" defaultValue={isOverride ? (active?.id ?? "") : ""} className="h-9 w-auto min-w-0 flex-1 sm:flex-none">
              <option value="">Par défaut ({templates.find((t) => t.isDefault)?.name ?? "—"})</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary" pendingLabel="…">
              Appliquer
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>

      {view === "mois" ? (
        <MonthCalendar days={days} month={month} today={today} />
      ) : view === "semaine" ? (
        <>
          <div className="hidden lg:block">
            <WeekGrid days={days} />
          </div>
          <div className="space-y-6 lg:hidden">
            {days
              .filter((d) => d.weekday <= 5 || d.appointments.length)
              .map((d) => (
                <DayList key={d.day} day={d} />
              ))}
          </div>
        </>
      ) : (
        <div className="max-w-2xl">
          <DayList day={days[0]!} showHeader={false} />
        </div>
      )}
    </>
  );
}

/** Premier jour du mois décalé de `n` mois. */
function shiftMonth(monthStart: string, n: number): string {
  const d = new Date(`${monthStart}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}
