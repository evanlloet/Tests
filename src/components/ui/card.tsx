import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[28px] border border-border/70 bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-bold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export type Pastel = "mint" | "peach" | "lilac" | "butter" | "pink" | "sky" | "coral";

const PASTEL_BG: Record<Pastel, string> = {
  mint: "bg-mint",
  peach: "bg-peach",
  lilac: "bg-lilac",
  butter: "bg-butter",
  pink: "bg-pink",
  sky: "bg-sky",
  coral: "bg-coral",
};

/** Tuile pastel : le texte reste à l'encre, quel que soit le thème. */
export function Tile({ color, className, ...props }: ComponentProps<"div"> & { color: Pastel }) {
  return <div className={cn("pastel-scope rounded-[24px] p-4 text-on-pastel", PASTEL_BG[color], className)} {...props} />;
}

export function pastelClass(color: Pastel) {
  return cn("pastel-scope", PASTEL_BG[color]);
}
