"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CategoryBadge, SectorDot } from "../ui/badge";
import { LeaMap, type MapPharmacy, type MapPlace, type MapStop } from "./lea-map";

const DUE_LABEL: Record<string, string> = {
  overdue: "En retard",
  never_visited: "Jamais visitée",
  due_soon: "À prévoir",
  planned: "Planifiée",
  ok: "À jour",
  unknown: "Fréquence inconnue",
};

/** Carte + liste synchronisées : sélectionner un élément d'un côté le sélectionne de l'autre. */
export function MapExplorer({
  pharmacies,
  stops,
  places,
  home,
  line,
  lineIsEstimate,
}: {
  pharmacies: (MapPharmacy & { city: string | null })[];
  stops: MapStop[];
  places: MapPlace[];
  home: { lat: number; lng: number } | null;
  line: [number, number][] | null;
  lineIsEstimate: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const hasTodo = pharmacies.some((p) => ["overdue", "never_visited", "due_soon"].includes(p.due));
  const [filter, setFilter] = useState<"todo" | "all">(hasTodo ? "todo" : "all");
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(
    () => (filter === "all" ? pharmacies : pharmacies.filter((p) => ["overdue", "never_visited", "due_soon"].includes(p.due))),
    [filter, pharmacies],
  );

  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1fr_360px]">
      <LeaMap
        pharmacies={shown}
        stops={stops}
        places={places}
        home={home}
        line={line}
        lineIsEstimate={lineIsEstimate}
        selectedId={selected}
        onSelect={setSelected}
        className="h-[55vh] lg:h-[calc(100dvh-12rem)]"
      />
      <div ref={listRef} className="space-y-4 lg:max-h-[calc(100dvh-12rem)] lg:overflow-auto">
        {stops.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Tournée du jour</h2>
            <ol className="space-y-1.5">
              {stops.map((s) => {
                const key = s.pharmacyId ?? s.id;
                return (
                  <li key={s.id} data-id={key}>
                    <button
                      type="button"
                      onClick={() => setSelected(key)}
                      aria-pressed={selected === key}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left text-sm",
                        selected === key ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-2",
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-fg">{s.order}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                      <span className="text-xs text-muted tabular-nums">{s.time}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Pharmacies</h2>
            <div className="flex rounded-full border border-border p-0.5 text-xs">
              {(
                [
                  ["todo", "À visiter"],
                  ["all", "Toutes"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  aria-pressed={filter === k}
                  className={cn("rounded-full px-2.5 py-1", filter === k ? "bg-ink text-ink-fg" : "text-muted")}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-2 text-xs text-muted">{shown.length} pharmacie(s) géolocalisée(s)</p>
          <ul className="space-y-1">
            {shown.slice(0, 300).map((p) => (
              <li key={p.id} data-id={p.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm",
                    selected === p.id ? "border-primary bg-primary-soft" : "border-transparent hover:bg-surface-2",
                  )}
                >
                  <button type="button" onClick={() => setSelected(p.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-pressed={selected === p.id}>
                    <SectorDot color={p.sectorColor} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.approx ? <span title="Position approximative : centre de la commune">≈ </span> : null}
                        {p.city} · {DUE_LABEL[p.due] ?? p.due}
                      </span>
                    </span>
                    <CategoryBadge category={p.category} />
                  </button>
                  {selected === p.id ? (
                    <Link href={`/pharmacies/${p.id}`} className="shrink-0 text-xs font-medium text-primary underline">
                      Fiche
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
        {places.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Lieux favoris</h2>
            <ul className="space-y-1 text-sm">
              {places.map((p) => (
                <li key={p.id} className="text-muted">
                  {p.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
