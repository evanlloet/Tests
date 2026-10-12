"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { normalizeText } from "@/domain/text";
import { cn } from "@/lib/cn";

export type PickerOption = { id: string; name: string; city: string | null; postalCode: string | null; category: string | null };

/** Recherche d'une pharmacie dans le référentiel (utilisable d'une main sur mobile). */
export function PharmacyPicker({
  options,
  name = "pharmacyId",
  defaultValue,
  required,
  onChange,
}: {
  options: PickerOption[];
  name?: string;
  defaultValue?: string | null;
  required?: boolean;
  onChange?: (option: PickerOption | null) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<PickerOption | null>(() => options.find((o) => o.id === defaultValue) ?? null);
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return [];
    const terms = q.split(" ");
    return options
      .filter((o) => {
        const hay = normalizeText(`${o.name} ${o.city ?? ""} ${o.postalCode ?? ""}`);
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 25);
  }, [options, query]);

  const choose = (o: PickerOption | null) => {
    setSelected(o);
    setQuery("");
    onChange?.(o);
  };

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-primary/40 bg-primary-soft px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <strong>{selected.name}</strong> <span className="text-muted">{[selected.postalCode, selected.city].filter(Boolean).join(" ")}</span>
          </span>
          <button type="button" className="shrink-0 text-xs font-medium text-primary underline" onClick={() => choose(null)}>
            Changer
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-5 text-muted" aria-hidden />
            <input
              id={id}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une pharmacie (nom, commune)…"
              aria-label="Rechercher une pharmacie"
              required={required && !selected}
              className="h-11 w-full rounded-full border border-border bg-surface pr-3 pl-10 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              autoComplete="off"
            />
          </div>
          {query ? (
            <ul role="listbox" aria-label="Résultats" className="max-h-64 overflow-auto rounded-2xl border border-border bg-surface">
              {results.length === 0 ? <li className="px-3 py-2 text-sm text-muted">Aucun résultat</li> : null}
              {results.map((o) => (
                <li key={o.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => choose(o)}
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2")}
                  >
                    <span className="truncate">{o.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {[o.postalCode, o.city].filter(Boolean).join(" ")}
                      {o.category ? ` · ${o.category}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
