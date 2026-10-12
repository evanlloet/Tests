import { TrendingDown, TrendingUp } from "lucide-react";
import { revenueEvolution } from "@/domain/client-data";
import { cn } from "@/lib/cn";
import { pastelClass, type Pastel } from "./ui/card";

const TAG_COLORS: Record<string, Pastel> = { Premium: "butter", "Perfect Store": "pink", GC: "sky", TLV: "mint" };

/** Ciblages du fichier clients (« Premium », « Perfect Store »…). */
export function TargetingChips({ tags, className }: { tags: string[] | null | undefined; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {tags.map((t) => (
        <span key={t} className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold text-on-pastel", pastelClass(TAG_COLORS[t.replace(/\s*\(.*\)$/, "")] ?? "lilac"))}>
          {t}
        </span>
      ))}
    </span>
  );
}

/** Canal différent de « Pharmacie » (GMS…), affiché en pastille sombre. */
export function ChannelBadge({ channel }: { channel: string | null | undefined }) {
  if (!channel || channel === "Pharmacie") return null;
  return <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-ink-fg">{channel}</span>;
}

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });

/** Évolution du CA A / A-1 avec flèche (texte toujours présent, pas seulement la couleur). */
export function RevenueTrend({ previous, current, className }: { previous: string | null | undefined; current: string | null | undefined; className?: string }) {
  const evo = revenueEvolution(previous, current);
  if (evo === null) return null;
  const up = evo >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", up ? "bg-success-soft text-success" : "bg-danger-soft text-danger", className)}
      title="Évolution du chiffre d'affaires A / A-1 (fichier clients)"
    >
      <Icon className="size-3.5" aria-hidden /> CA {percent.format(evo)}
    </span>
  );
}
