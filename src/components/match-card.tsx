"use client";

import { useActionState, useState } from "react";
import { ignoreMatchAction, validateMatchAction } from "@/server/actions/calendar";
import type { ActionResult } from "@/server/actions/result";
import { cn } from "@/lib/cn";
import { PharmacyPicker, type PickerOption } from "./pharmacy-picker";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

export type MatchCardData = {
  id: string;
  /** Plus dans la liste du serveur (traité ailleurs, ex. validation groupée) */
  resolved?: boolean;
  status: string;
  score: number;
  event: { title: string; when: string; location: string | null; classificationReason: string; description: string | null };
  candidates: { pharmacyId: string; score: number; reasons: string[]; name: string; address: string }[];
  currentPharmacyId: string | null;
};

function confidence(candidates: MatchCardData["candidates"]): { label: string; tone: "success" | "warning" | "danger" } {
  const [best, second] = candidates;
  const score = best?.score ?? 0;
  if (best && second && best.score - second.score < 0.05) return { label: "Ambigu : plusieurs pharmacies possibles", tone: "warning" };
  if (score >= 0.85) return { label: "Confiance élevée", tone: "success" };
  if (score >= 0.6) return { label: "Confiance moyenne", tone: "warning" };
  return { label: "Confiance faible", tone: "danger" };
}

/**
 * Liste de cartes : une carte traitée reste affichée (avec sa confirmation) jusqu'au
 * prochain changement de page, même si la liste du serveur ne la contient plus.
 */
export function MatchList({ cards, options }: { cards: MatchCardData[]; options: PickerOption[] }) {
  const [prevCards, setPrevCards] = useState(cards);
  const [items, setItems] = useState(cards);
  if (cards !== prevCards) {
    setPrevCards(cards);
    const fresh = new Map(cards.map((c) => [c.id, c]));
    const merged = items.map((i) => fresh.get(i.id) ?? { ...i, resolved: true });
    for (const c of cards) if (!items.some((i) => i.id === c.id)) merged.push(c);
    setItems(merged);
  }
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {items.map((c) => (
        <MatchCard key={c.id} data={c} options={options} />
      ))}
    </div>
  );
}

export function MatchCard({ data, options }: { data: MatchCardData; options: PickerOption[] }) {
  const [choice, setChoice] = useState<string>(data.currentPharmacyId ?? data.candidates[0]?.pharmacyId ?? "other");
  const [other, setOther] = useState<string | null>(null);
  const [validateState, validate, validating] = useActionState(async (_: ActionResult | null, fd: FormData) => validateMatchAction(fd), null);
  const [ignoreState, ignore, ignoring] = useActionState(async (_: ActionResult | null, fd: FormData) => ignoreMatchAction(fd), null);
  const chosenId = choice === "other" ? other : choice;
  const done = validateState?.ok || ignoreState?.ok;
  const decided = data.status === "validated" || data.status === "auto_validated" || data.status === "ignored";

  if (data.resolved && !done) {
    return (
      <article className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted">
        « {data.event.title} » ({data.event.when}) — traité.
      </article>
    );
  }

  return (
    <article className={cn("rounded-2xl border border-border bg-surface p-4 shadow-card", done && "opacity-60")} aria-label={`Rendez-vous ${data.event.title}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">{data.event.when}</p>
          <h3 className="font-semibold">« {data.event.title} »</h3>
          {data.event.location ? <p className="text-sm text-muted">Lieu : {data.event.location}</p> : null}
          {data.event.description ? <p className="mt-1 line-clamp-2 text-xs text-muted">{data.event.description}</p> : null}
        </div>
        {data.candidates[0] ? (
          <Badge tone={confidence(data.candidates).tone}>
            {confidence(data.candidates).label} · {Math.round(data.candidates[0].score * 100)} %
          </Badge>
        ) : (
          <Badge tone="danger">Aucune pharmacie trouvée</Badge>
        )}
      </header>

      <fieldset className="mt-3 space-y-2" disabled={done}>
        <legend className="sr-only">Pharmacie correspondante</legend>
        {data.candidates.map((c, i) => (
          <label
            key={c.pharmacyId}
            className={cn(
              "flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm",
              choice === c.pharmacyId ? "border-primary bg-primary-soft/50" : "border-border hover:bg-surface-2",
            )}
          >
            <input type="radio" name={`choice-${data.id}`} checked={choice === c.pharmacyId} onChange={() => setChoice(c.pharmacyId)} className="mt-1 accent-[var(--primary)]" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted tabular-nums">{Math.round(c.score * 100)} %</span>
                {i === 0 ? <span className="text-xs text-primary">proposée</span> : null}
              </span>
              <span className="block text-xs text-muted">{c.address}</span>
              <span className="mt-0.5 block text-xs text-muted">{c.reasons.join(" · ")}</span>
            </span>
          </label>
        ))}
        <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm", choice === "other" ? "border-primary" : "border-border")}>
          <input type="radio" name={`choice-${data.id}`} checked={choice === "other"} onChange={() => setChoice("other")} className="accent-[var(--primary)]" />
          Choisir une autre pharmacie
        </label>
        {choice === "other" ? <PharmacyPicker options={options} name={`other-${data.id}`} onChange={(o) => setOther(o?.id ?? null)} /> : null}
      </fieldset>

      {validateState && !validateState.ok ? <Notice tone="danger" className="mt-3">{validateState.error}</Notice> : null}
      {ignoreState && !ignoreState.ok ? <Notice tone="danger" className="mt-3">{ignoreState.error}</Notice> : null}
      {done ? <Notice tone="success" className="mt-3">{validateState?.ok ? validateState.message : ignoreState?.ok ? ignoreState.message : ""}</Notice> : null}

      {!done ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={validate}>
            <input type="hidden" name="matchId" value={data.id} />
            <input type="hidden" name="pharmacyId" value={chosenId ?? ""} />
            <Button type="submit" disabled={!chosenId || validating}>
              {validating ? "Validation…" : decided && data.status !== "ignored" ? "Confirmer ce choix" : "Valider"}
            </Button>
          </form>
          {data.status !== "ignored" ? (
            <form action={ignore}>
              <input type="hidden" name="matchId" value={data.id} />
              <Button type="submit" variant="secondary" disabled={ignoring}>
                {ignoring ? "…" : "Ignorer (pas une visite)"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
