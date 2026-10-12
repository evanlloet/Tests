/**
 * Graphiques simples en HTML/CSS (rendu serveur) :
 * - barres fines (≤ 24 px), extrémité arrondie de 4 px, base carrée ;
 * - info-bulle au survol ET au focus clavier, cible plus large que la barre ;
 * - libellés sélectifs, texte en couleurs de texte (jamais la couleur de la série) ;
 * - chaque graphique a une vue tableau équivalente.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type ColumnDatum = { key: string; label: string; value: number; tooltip?: string };

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= max / 4)! * pow;
  return Math.ceil(max / step) * step;
}

/** Histogramme à une série. `labelAll` : valeur sur chaque colonne (peu de colonnes). */
export function ColumnChart({
  data,
  height = 160,
  labelAll = true,
  color = "var(--primary)",
  valueSuffix = "",
  ariaLabel,
}: {
  data: ColumnDatum[];
  height?: number;
  labelAll?: boolean;
  color?: string;
  valueSuffix?: string;
  ariaLabel: string;
}) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const maxIndex = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const ticks = [0, max / 2, max];
  return (
    <figure aria-label={ariaLabel} className="w-full">
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0 text-right text-[10px] text-muted tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: height - (t / max) * height }}>
              {t.toLocaleString("fr-FR")}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0" style={{ height }} aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: height - (t / max) * height }} />
            ))}
          </div>
          <div className="relative flex items-end gap-0.5" style={{ height }}>
            {data.map((d, i) => {
              const h = (d.value / max) * height;
              const showLabel = labelAll || i === maxIndex || i === data.length - 1;
              return (
                <div
                  key={d.key}
                  tabIndex={0}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                  aria-label={d.tooltip ?? `${d.label} : ${d.value}${valueSuffix}`}
                >
                  {showLabel && d.value > 0 ? (
                    <span className="absolute text-[11px] font-medium tabular-nums" style={{ bottom: h + 2 }}>
                      {d.value.toLocaleString("fr-FR")}
                    </span>
                  ) : null}
                  <span
                    className="block w-full max-w-6 rounded-t-[4px] transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                    style={{ height: Math.max(d.value > 0 ? 2 : 0, h), backgroundColor: color }}
                  />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full z-10 mb-6 hidden rounded-lg border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-card group-hover:block group-focus-visible:block"
                  >
                    <strong className="tabular-nums">
                      {d.value.toLocaleString("fr-FR")}
                      {valueSuffix}
                    </strong>{" "}
                    <span className="text-muted">{d.tooltip ?? d.label}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-0.5" aria-hidden>
            {data.map((d) => (
              <span key={d.key} className="flex-1 truncate text-center text-[10px] text-muted">
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export type StackSegment = { key: string; label: string; value: number; color: string };

/** Barres horizontales empilées à 100 % (une ligne par catégorie), avec légende. */
export function StackedBars({
  rows,
  legend,
  ariaLabel,
}: {
  rows: { key: string; label: string; total: number; segments: StackSegment[] }[];
  legend: { key: string; label: string; color: string }[];
  ariaLabel: string;
}) {
  return (
    <figure aria-label={ariaLabel} className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Légende">
        {legend.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
            {l.label}
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[72px_1fr_44px] items-center gap-2">
            <span className="text-sm">{r.label}</span>
            <div className="flex h-5 gap-[2px]">
              {r.segments
                .filter((s) => s.value > 0)
                .map((s, i, arr) => {
                  const pct = (s.value / r.total) * 100;
                  return (
                    <div
                      key={s.key}
                      tabIndex={0}
                      className={cn("group relative h-full outline-none", i === arr.length - 1 && "rounded-r-[4px]")}
                      style={{ width: `${pct}%`, backgroundColor: s.color }}
                      aria-label={`${r.label}, ${s.label} : ${s.value} (${Math.round(pct)} %)`}
                    >
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap text-text shadow-card group-hover:block group-focus-visible:block"
                      >
                        <strong className="tabular-nums">
                          {s.value} ({Math.round(pct)} %)
                        </strong>{" "}
                        <span className="text-muted">{s.label}</span>
                      </span>
                    </div>
                  );
                })}
            </div>
            <span className="text-right text-xs text-muted tabular-nums">{r.total}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Vue tableau repliable, équivalente au graphique. */
export function TableView({ caption, headers, rows }: { caption: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted hover:text-text">Voir les données (tableau)</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-muted">
              {headers.map((h) => (
                <th key={h} className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="py-1 pr-3 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Jauge : part d'un total (piste = teinte claire de la même couleur). */
export function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium tabular-nums">
          {pct} % <span className="text-xs text-muted">({value.toLocaleString("fr-FR")}/{total.toLocaleString("fr-FR")})</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-accent-soft" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
