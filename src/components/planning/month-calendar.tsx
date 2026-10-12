import { Check } from "lucide-react";
import Link from "next/link";
import { Buddy } from "@/components/buddy";
import { BUDDY_PASTEL, MoodChip } from "@/components/mood-ui";
import { Tile } from "@/components/ui/card";
import { DAY_MOODS, type DayMoodKey } from "@/domain/mood";
import { WEEKDAY_SHORT, type DayKey } from "@/domain/time";
import { cn } from "@/lib/cn";
import type { PlanningDay } from "@/server/services/planning";

const SUMMARY: Record<DayMoodKey, string> = {
  balanced: "Un mois bien équilibré : des journées remplies mais réalistes.",
  light: "Un mois tranquille, avec de la marge pour les imprévus.",
  busy: "Un mois chargé : quelques journées mériteraient d'être allégées.",
  overloaded: "Un mois sous tension : plusieurs journées débordent.",
  free: "Peu de visites ce mois-ci.",
  weekend: "Peu de visites ce mois-ci.",
  holiday: "Peu de visites ce mois-ci.",
};

/** Calendrier d'humeur : un bonhomme par jour, coloré selon la charge de la journée. */
export function MonthCalendar({ days, month, today }: { days: PlanningDay[]; month: string; today: DayKey }) {
  const working = days.filter((d) => d.day.startsWith(month) && d.visits > 0);
  const counts = new Map<DayMoodKey, number>();
  for (const d of working) counts.set(d.mood.key, (counts.get(d.mood.key) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "free";
  const dominantMood = DAY_MOODS[dominant];
  const totalVisits = working.reduce((n, d) => n + d.visits, 0);
  const km = working.reduce((n, d) => n + (d.driveKm ?? 0), 0);
  const zen = (counts.get("balanced") ?? 0) + (counts.get("light") ?? 0);
  const heavy = (counts.get("busy") ?? 0) + (counts.get("overloaded") ?? 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div className="rounded-[28px] border border-border/70 bg-surface p-4 shadow-card sm:p-5">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <span key={w} className="pb-1 text-center text-xs font-semibold text-muted">
              {WEEKDAY_SHORT[w]}
            </span>
          ))}
          {days.map((d) => {
            const inMonth = d.day.startsWith(month);
            const isToday = d.day === today;
            return (
              <Link
                key={d.day}
                href={`/planning?vue=jour&date=${d.day}`}
                className={cn(
                  "group relative flex aspect-square flex-col items-center justify-center rounded-[16px] transition hover:-translate-y-0.5",
                  !inMonth && "opacity-30",
                  isToday && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
                )}
                title={`${d.mood.label} — ${d.visits} visite(s)`}
                aria-label={`${d.day} : ${d.mood.label}, ${d.visits} visite(s)`}
              >
                {d.visits > 0 || d.weekday <= 5 ? (
                  <Buddy mood={d.mood.mood} shape="squircle" color={d.mood.color} size={44} className="h-auto w-full max-w-12" />
                ) : (
                  <span className="size-full rounded-[16px] bg-surface-2" />
                )}
                <span className="absolute top-0.5 left-1 text-[10px] font-bold text-on-pastel/70">{Number(d.day.slice(8))}</span>
                {d.allClosed ? (
                  <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-ink text-ink-fg">
                    <Check className="size-2.5" aria-hidden />
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Légende">
          {(["light", "balanced", "busy", "overloaded", "free"] as const).map((k) => (
            <MoodChip key={k} mood={DAY_MOODS[k]} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Tile color={BUDDY_PASTEL[dominantMood.color]} className="relative overflow-hidden p-5">
          <p className="text-sm font-semibold opacity-75">Humeur du mois</p>
          <p className="mt-1 font-display text-4xl font-extrabold">{working.length ? dominantMood.label : "Calme"}</p>
          <p className="mt-1 max-w-[70%] text-sm">{working.length ? SUMMARY[dominant] : SUMMARY.free}</p>
          <Buddy mood={dominantMood.mood} shape={dominantMood.shape} color={dominantMood.color} size={110} className="absolute -right-4 -bottom-6 rotate-[-8deg] opacity-90" />
        </Tile>
        <div className="grid grid-cols-3 gap-3">
          <Tile color="peach" className="p-3">
            <p className="text-xs font-semibold">Visites</p>
            <p className="font-display text-2xl font-extrabold">{totalVisits}</p>
          </Tile>
          <Tile color="mint" className="p-3">
            <p className="text-xs font-semibold">Journées zen</p>
            <p className="font-display text-2xl font-extrabold">{zen}</p>
          </Tile>
          <Tile color="lilac" className="p-3">
            <p className="text-xs font-semibold">Chargées</p>
            <p className="font-display text-2xl font-extrabold">{heavy}</p>
          </Tile>
        </div>
        <p className="text-xs text-muted">Kilométrage estimé du mois : ~{Math.round(km).toLocaleString("fr-FR")} km (à vol d'oiseau).</p>
      </div>
    </div>
  );
}
