"use client";

import { CalendarPlus, Navigation, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Buddy } from "@/components/buddy";
import type { DueState } from "@/domain/frequency";
import { PHARMACY_MOODS } from "@/domain/mood";
import { normalizeText } from "@/domain/text";
import { cn } from "@/lib/cn";
import { CategoryBadge, SectorDot } from "../ui/badge";
import { DUE_BUDDY_COLOR, DUE_LABEL, LeaMap, type MapColorMode, type MapPharmacy, type MapPlace, type MapSector, type MapStop } from "./lea-map";

export type ExplorerPharmacy = MapPharmacy & { city: string | null; note?: string };

const TODO = ["overdue", "never_visited", "due_soon"];
const FILTERS = [
  ["todo", "À visiter"],
  ["overdue", "En retard"],
  ["all", "Toutes"],
] as const;
const CATEGORIES = ["A", "B", "C", "D"] as const;
const COUNT_LABEL: Record<string, string> = {
  overdue: "en retard",
  due_soon: "à prévoir",
  never_visited: "jamais visitée(s)",
  planned: "planifiée(s)",
  ok: "à jour",
};

/** Carte + liste synchronisées : sélectionner un élément d'un côté le sélectionne de l'autre. */
export function MapExplorer({
  pharmacies,
  stops,
  places,
  home,
  line,
  lineIsEstimate,
  sectors = [],
}: {
  pharmacies: ExplorerPharmacy[];
  stops: MapStop[];
  places: MapPlace[];
  home: { lat: number; lng: number } | null;
  line: [number, number][] | null;
  lineIsEstimate: boolean;
  sectors?: MapSector[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<string[] | null>(null);
  const hasTodo = pharmacies.some((p) => TODO.includes(p.due));
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>(hasTodo ? "todo" : "all");
  const [categories, setCategories] = useState<Set<string>>(new Set(CATEGORIES));
  const [colorMode, setColorMode] = useState<MapColorMode>("mood");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = normalizeText(query);
    return pharmacies.filter(
      (p) =>
        (filter === "all" || (filter === "overdue" ? p.due === "overdue" : TODO.includes(p.due))) &&
        (p.category === null || categories.has(p.category)) &&
        (!q || normalizeText(`${p.name} ${p.city ?? ""}`).includes(q)),
    );
  }, [filter, categories, query, pharmacies]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of pharmacies) c[p.due] = (c[p.due] ?? 0) + 1;
    return c;
  }, [pharmacies]);
  const byId = useMemo(() => new Map(pharmacies.map((p) => [p.id, p])), [pharmacies]);
  const current = selected ? byId.get(selected) : undefined;

  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setGroup((g) => (g?.includes(id) ? g : null));
  };
  const toggleCategory = (c: string) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next.size ? next : new Set(CATEGORIES);
    });

  return (
    <div className="space-y-3">
      {/* Résumé et filtres */}
      <div className="flex flex-wrap items-center gap-2">
        {(["overdue", "due_soon", "never_visited", "planned", "ok"] as const).map((d) =>
          counts[d] ? (
            <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold shadow-card">
              <Buddy mood={PHARMACY_MOODS[d].mood} shape="circle" color={DUE_BUDDY_COLOR[d]} size={18} />
              {counts[d]} {COUNT_LABEL[d]}
            </span>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">Rechercher une pharmacie</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pharmacie ou commune…"
            className="h-9 w-full rounded-full border border-border bg-surface pr-3 pl-9 text-sm outline-none focus:border-primary"
          />
        </label>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={FILTERS.map(([k, l]) => ({ value: k, label: l }))}
          label="Pharmacies affichées"
        />
        <div className="flex gap-1" role="group" aria-label="Catégories">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              aria-pressed={categories.has(c)}
              className={cn(
                "size-9 rounded-full text-sm font-extrabold transition",
                categories.has(c) ? "bg-ink text-ink-fg" : "border border-border bg-surface text-muted line-through",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <Segmented
          value={colorMode}
          onChange={setColorMode}
          options={[
            { value: "mood", label: "Humeur" },
            { value: "category", label: "Catégorie" },
          ]}
          label="Couleur des pharmacies"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1fr_340px]">
        <LeaMap
          pharmacies={shown}
          stops={stops}
          places={places}
          home={home}
          line={line}
          lineIsEstimate={lineIsEstimate}
          sectors={sectors}
          colorMode={colorMode}
          selectedId={selected}
          onSelect={select}
          onGroupSelect={(ids) => {
            setGroup(ids);
            setSelected(null);
          }}
          className="h-[58vh] lg:h-[calc(100dvh-15rem)]"
        >
          {current ? (
            <PharmacyCard pharmacy={current} onClose={() => setSelected(null)} />
          ) : group ? (
            <GroupCard pharmacies={group.map((id) => byId.get(id)).filter((p): p is ExplorerPharmacy => Boolean(p))} onPick={select} onClose={() => setGroup(null)} />
          ) : null}
        </LeaMap>

        <div ref={listRef} className="space-y-4 lg:max-h-[calc(100dvh-15rem)] lg:overflow-auto lg:pr-1">
          {stops.length ? (
            <section>
              <h2 className="mb-2 text-sm font-bold">Tournée du jour</h2>
              <ol className="space-y-1.5">
                {stops.map((s) => {
                  const key = s.pharmacyId ?? s.id;
                  return (
                    <li key={s.id} data-id={key}>
                      <button
                        type="button"
                        onClick={() => select(key)}
                        aria-pressed={selected === key}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left text-sm",
                          selected === key ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-2",
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-ink-fg">{s.order}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{s.label}</span>
                        <span className="text-xs text-muted tabular-nums">{s.time}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
          <section>
            <h2 className="mb-2 text-sm font-bold">
              Pharmacies <span className="font-normal text-muted">· {shown.length}</span>
            </h2>
            {shown.length === 0 ? <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">Aucune pharmacie avec ces filtres.</p> : null}
            <ul className="space-y-1">
              {shown.slice(0, 300).map((p) => (
                <li key={p.id} data-id={p.id}>
                  <button
                    type="button"
                    onClick={() => select(p.id)}
                    aria-pressed={selected === p.id}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left text-sm",
                      selected === p.id ? "border-primary bg-primary-soft" : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <Buddy mood={PHARMACY_MOODS[p.due as DueState]?.mood ?? "calm"} shape="circle" color={DUE_BUDDY_COLOR[p.due] ?? "gray"} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted">
                        <SectorDot color={p.sectorColor} className="size-2" />
                        {p.approx ? <span title="Position approximative : centre de la commune">≈</span> : null}
                        {p.city} · {DUE_LABEL[p.due] ?? p.due}
                      </span>
                    </span>
                    <CategoryBadge category={p.category} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {places.length ? (
            <section>
              <h2 className="mb-2 text-sm font-bold">Lieux favoris</h2>
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
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div className="flex rounded-full border border-border bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn("rounded-full px-3 py-1.5", value === o.value ? "bg-ink text-ink-fg" : "text-muted hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Carte de la pharmacie choisie, en surimpression sur la carte. */
function PharmacyCard({ pharmacy: p, onClose }: { pharmacy: ExplorerPharmacy; onClose: () => void }) {
  // Position approximative : on confie la recherche de l'officine à l'application GPS (nom + commune)
  const destination = p.approx ? `${p.name}, ${p.city ?? ""}` : `${p.lat},${p.lng}`;
  return (
    <div className="rounded-[24px] bg-white p-4 text-[#17132b] shadow-xl">
      <div className="flex items-start gap-3">
        <Buddy mood={PHARMACY_MOODS[p.due as DueState]?.mood ?? "calm"} shape="circle" color={DUE_BUDDY_COLOR[p.due] ?? "gray"} size={48} animate />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-display text-lg leading-tight font-extrabold">{p.name}</p>
            <CategoryBadge category={p.category} />
          </div>
          <p className="text-xs text-[#6e6787]">
            {p.city}
            {p.approx ? " · position approximative" : ""} · {DUE_LABEL[p.due] ?? p.due}
          </p>
          {p.note ? <p className="mt-1 text-sm leading-snug">{p.note}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-[#6e6787] hover:bg-[#f1eef8]" aria-label="Fermer">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/pharmacies/${p.id}`} className="rounded-full bg-[#17132b] px-4 py-2 text-xs font-bold text-white">
          Voir la fiche
        </Link>
        <Link href={`/planning/nouveau?pharmacie=${p.id}`} className="inline-flex items-center gap-1 rounded-full border border-[#e5dff2] px-3 py-2 text-xs font-bold">
          <CalendarPlus className="size-3.5" aria-hidden /> Planifier
        </Link>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-[#e5dff2] px-3 py-2 text-xs font-bold"
        >
          <Navigation className="size-3.5" aria-hidden /> Itinéraire
        </a>
      </div>
    </div>
  );
}

/** Pharmacies regroupées au même endroit (centre de commune) ou dans une bulle. */
function GroupCard({ pharmacies, onPick, onClose }: { pharmacies: ExplorerPharmacy[]; onPick: (id: string) => void; onClose: () => void }) {
  const city = pharmacies.every((p) => p.city === pharmacies[0]?.city) ? pharmacies[0]?.city : null;
  return (
    <div className="rounded-[24px] bg-white p-3 text-[#17132b] shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="font-display font-extrabold">
          {pharmacies.length} pharmacies{city ? ` à ${city}` : ""}
        </p>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-[#6e6787] hover:bg-[#f1eef8]" aria-label="Fermer">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <ul className="max-h-60 space-y-0.5 overflow-auto">
        {pharmacies.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.id)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-[#f1eef8]">
              <Buddy mood={PHARMACY_MOODS[p.due as DueState]?.mood ?? "calm"} shape="circle" color={DUE_BUDDY_COLOR[p.due] ?? "gray"} size={24} />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="text-xs text-[#6e6787]">{DUE_LABEL[p.due]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
