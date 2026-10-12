import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { CATEGORY_COLORS, UNKNOWN_CATEGORY_COLOR } from "@/lib/palette";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  primary: "bg-primary-soft text-primary border-primary/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/20",
  info: "bg-info-soft text-info border-info/20",
  accent: "bg-accent-soft text-accent border-accent/20",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!category) {
    return (
      <Badge tone="neutral" title="Catégorie non renseignée">
        Cat. ?
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" title={`Catégorie ${category}`} className="text-text">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] ?? UNKNOWN_CATEGORY_COLOR }} />
      {category}
    </Badge>
  );
}

export function SectorDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color ?? "var(--muted)" }}
    />
  );
}
