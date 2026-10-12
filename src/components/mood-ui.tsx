/** Éléments visuels « humeur » partagés : journées, pharmacies, jauges. */
import { Heart } from "lucide-react";
import type { DueState } from "@/domain/frequency";
import { avatarFor, PHARMACY_MOODS, type BuddyColor, type MoodVisual } from "@/domain/mood";
import { cn } from "@/lib/cn";
import { Buddy } from "./buddy";
import type { Pastel } from "./ui/card";

export function DayBuddy({ mood, size = 40, className, animate }: { mood: MoodVisual; size?: number; className?: string; animate?: boolean }) {
  return <Buddy mood={mood.mood} shape={mood.shape} color={mood.color} size={size} label={`${mood.label} — ${mood.hint}`} className={className} animate={animate} />;
}

/** Pastille « bonhomme + libellé », comme les puces d'humeur. */
export function MoodChip({ mood, label, active, className }: { mood: MoodVisual; label?: string; active?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-xs font-semibold",
        active ? "border-ink bg-ink text-ink-fg" : "border-border bg-surface",
        className,
      )}
    >
      <Buddy mood={mood.mood} shape={mood.shape} color={mood.color} size={22} />
      {label ?? mood.label}
    </span>
  );
}

/** Avatar d'une pharmacie : forme et couleur stables, humeur selon le suivi. */
export function PharmacyAvatar({ id, dueState, size = 44, className, animate }: { id: string; dueState: DueState; size?: number; className?: string; animate?: boolean }) {
  const { shape, color } = avatarFor(id);
  const m = PHARMACY_MOODS[dueState];
  return <Buddy mood={m.mood} shape={shape} color={color} size={size} label={m.label} className={className} animate={animate} />;
}

/** Jauge de visites de l'année en cœurs (réalisées ou identifiées / objectif). */
export function Hearts({ value, planned = 0, target, size = 16 }: { value: number; planned?: number; target: number | null; size?: number }) {
  if (!target) return <span className="text-xs text-muted">Objectif à définir</span>;
  const shown = Math.min(target, 12);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} visite(s) sur ${target} cette année${planned ? `, ${planned} prévue(s)` : ""}`}>
      {Array.from({ length: shown }, (_, i) => {
        const filled = i < value;
        const plannedSlot = !filled && i < value + planned;
        return (
          <Heart
            key={i}
            style={{ width: size, height: size }}
            className={cn(filled ? "fill-[#ff4f7b] text-[#ff4f7b]" : plannedSlot ? "fill-[#ffc2d4] text-[#ff8fb1]" : "text-border")}
            aria-hidden
          />
        );
      })}
      {target > shown ? <span className="ml-1 text-xs text-muted">/{target}</span> : null}
    </span>
  );
}

/** Anneau de progression (niveau, objectif). */
export function ProgressRing({ value, size = 64, stroke = 7, children, color = "var(--ink)" }: { value: number; size?: number; stroke?: number; children?: React.ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display font-extrabold">{children}</span>
    </span>
  );
}

/** Barre de progression arrondie. */
export function ProgressBar({ value, target, className, color = "bg-ink" }: { value: number; target: number; className?: string; color?: string }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className={cn("h-2.5 overflow-hidden rounded-full bg-black/10", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={target}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Pastel de tuile assorti à la couleur d'un bonhomme. */
export const BUDDY_PASTEL: Record<BuddyColor, Pastel> = {
  green: "mint",
  yellow: "butter",
  orange: "peach",
  red: "coral",
  purple: "lilac",
  blue: "sky",
  pink: "pink",
  gray: "lilac",
};

/** Phrase d'humeur d'une pharmacie (ton doux, jamais culpabilisant). */
export function pharmacyMoodSentence(status: {
  dueState: DueState;
  daysUntilDue: number | null;
  nextPlanned: string | null;
  nextDue: string | null;
}, formatDay: (d: string) => string): string {
  switch (status.dueState) {
    case "ok":
      return status.nextDue ? `Tout va bien : prochaine visite vers le ${formatDay(status.nextDue)}.` : "Tout va bien.";
    case "planned":
      return status.nextPlanned ? `Rendez-vous prévu le ${formatDay(status.nextPlanned)} : elle a hâte !` : "Rendez-vous prévu.";
    case "due_soon":
      return `C'est bientôt l'heure de repasser (d'ici ${status.daysUntilDue ?? 0} j).`;
    case "overdue":
      return `Elle vous attend depuis ${-(status.daysUntilDue ?? 0)} jours.`;
    case "never_visited":
      return "Pas encore de visite connue : faites connaissance !";
    case "unknown":
      return "Ajoutez sa catégorie pour suivre les échéances.";
  }
}
