"use client";

import { ArrowLeft, ArrowRight, CalendarDays, Check, FileUp, Home, Map as MapIcon, Minus, Plus, Search, Sparkles, Store, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { normalizeText } from "@/domain/text";
import { TOWNS } from "@/domain/towns";
import { cn } from "@/lib/cn";
import { CATEGORY_COLORS } from "@/lib/palette";
import {
  completeOnboardingAction,
  saveFrequenciesStep,
  saveHomeStep,
  saveRewardsStep,
  saveRhythmStep,
  saveSectorsStep,
  saveWeekStep,
  tourSeenStep,
} from "@/server/actions/onboarding";
import type { ActionResult } from "@/server/actions/result";
import { Buddy, BuddyCrowd } from "../buddy";
import { Confetti } from "../confetti";
import { Button } from "../ui/button";
import { Notice } from "../ui/notice";

export type OnboardingData = {
  firstName: string;
  step: number;
  home: { lat: number | null; lng: number | null; address: string | null };
  territories: { code: string; name: string; color: string; isActive: boolean }[];
  departments: [string, string][];
  week: Record<number, string[]>;
  rhythm: { workDayStart: string; workDayEnd: string; lunchStart: string; lunchMinutes: number; defaultVisitMinutes: number; bufferMinutes: number };
  frequencies: { A: number; B: number; C: number; D: number };
  gamificationEnabled: boolean;
};

const STEPS = ["intro", "home", "sectors", "week", "rhythm", "frequencies", "rewards", "tour", "done"] as const;
const WEEKDAYS: [number, string][] = [
  [1, "Lundi"],
  [2, "Mardi"],
  [3, "Mercredi"],
  [4, "Jeudi"],
  [5, "Vendredi"],
];

export function Onboarding({ data }: { data: OnboardingData }) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(0, data.step), STEPS.length - 1));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = STEPS[step]!;

  const go = (to: number) => {
    setError(null);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const submit = (action: (fd: FormData) => Promise<ActionResult>, refresh = false) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) return setError(res.error);
      if (refresh) router.refresh();
      go(step + 1);
    });
  };

  if (current === "tour") {
    return (
      <Tour
        gamification={data.gamificationEnabled}
        onBack={() => go(step - 1)}
        onDone={() =>
          startTransition(async () => {
            await tourSeenStep();
            go(step + 1);
          })
        }
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pt-5 pb-8">
      <header className="mb-6 flex items-center gap-3">
        {step > 0 ? (
          <button type="button" onClick={() => go(step - 1)} className="flex size-10 items-center justify-center rounded-full bg-surface shadow-card" aria-label="Étape précédente">
            <ArrowLeft className="size-5" />
          </button>
        ) : (
          <span className="size-10" />
        )}
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label="Progression">
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-ink" : "bg-border")} />
          ))}
        </div>
        {current !== "done" ? (
          <form action={completeOnboardingAction}>
            <input type="hidden" name="next" value="accueil" />
            <button type="submit" className="text-sm font-semibold text-muted hover:text-text">
              Plus tard
            </button>
          </form>
        ) : (
          <span className="w-14" />
        )}
      </header>

      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      {current === "intro" ? (
        <Step
          title={
            <>
              Bonjour {data.firstName} !<br />
              On prépare vos tournées ?
            </>
          }
          subtitle="Quelques questions pour que Léa connaisse votre secteur, votre domicile et votre rythme. Comptez trois minutes, tout reste modifiable ensuite."
          illustration={<BuddyCrowd className="mx-auto h-72 w-full max-w-sm" />}
          footer={
            <Button size="xl" className="w-full" onClick={() => go(1)}>
              C'est parti <ArrowRight className="size-5" />
            </Button>
          }
        />
      ) : null}

      {current === "home" ? <HomeStep data={data} pending={pending} onSubmit={submit(saveHomeStep)} /> : null}
      {current === "sectors" ? <SectorsStep data={data} pending={pending} onSubmit={submit(saveSectorsStep, true)} /> : null}
      {current === "week" ? <WeekStep data={data} pending={pending} onSubmit={submit(saveWeekStep)} /> : null}
      {current === "rhythm" ? <RhythmStep data={data} pending={pending} onSubmit={submit(saveRhythmStep)} /> : null}
      {current === "frequencies" ? <FrequenciesStep data={data} pending={pending} onSubmit={submit(saveFrequenciesStep)} /> : null}
      {current === "rewards" ? <RewardsStep data={data} pending={pending} onSubmit={submit(saveRewardsStep, true)} /> : null}
      {current === "done" ? <DoneStep firstName={data.firstName} /> : null}
    </div>
  );
}

function Step({ title, subtitle, illustration, children, footer }: { title: ReactNode; subtitle?: ReactNode; illustration?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <section className="flex flex-1 flex-col">
      {illustration ? <div className="mb-6">{illustration}</div> : null}
      <h1 className="text-4xl leading-[1.05] font-extrabold">{title}</h1>
      {subtitle ? <p className="mt-3 text-base text-muted">{subtitle}</p> : null}
      {children ? <div className="mt-6 flex-1">{children}</div> : <div className="flex-1" />}
      {footer ? <div className="sticky bottom-4 mt-8">{footer}</div> : null}
    </section>
  );
}

function ContinueButton({ pending, label = "Continuer" }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" size="xl" className="w-full" disabled={pending}>
      {pending ? "Enregistrement…" : label} {!pending ? <ArrowRight className="size-5" /> : null}
    </Button>
  );
}

function HomeStep({ data, pending, onSubmit }: { data: OnboardingData; pending: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const initial = TOWNS.find((t) => data.home.lat !== null && Math.abs(t.lat - data.home.lat) < 0.001 && Math.abs(t.lng - (data.home.lng ?? 0)) < 0.001)?.key;
  const [town, setTown] = useState<string>(initial ?? (data.home.lat === null ? "rennes" : "other"));
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = normalizeText(query);
    return q ? TOWNS.filter((t) => normalizeText(t.name).includes(q)) : TOWNS.slice(0, 12);
  }, [query]);
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <Step
        title="Où habitez-vous ?"
        subtitle="C'est le point de départ et d'arrivée de vos tournées : Léa s'en sert pour estimer les trajets et repérer les journées lointaines."
        illustration={
          <div className="flex items-end gap-3">
            <div className="flex size-20 items-center justify-center rounded-[28px] bg-sky">
              <Home className="size-10 text-on-pastel" aria-hidden />
            </div>
            <Buddy mood="happy" shape="blob" color="pink" size={72} className="buddy-hover" />
          </div>
        }
        footer={<ContinueButton pending={pending} />}
      >
        <input type="hidden" name="town" value={town === "other" ? "" : town} />
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-3.5 left-4 size-5 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une commune…"
            aria-label="Rechercher une commune"
            className="h-12 w-full rounded-full border border-border bg-surface pr-4 pl-12 text-base focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Commune du domicile">
          {shown.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={town === t.key}
              onClick={() => setTown(t.key)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition",
                town === t.key ? "border-ink bg-ink text-ink-fg" : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              {t.name}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={town === "other"}
            onClick={() => setTown("other")}
            className={cn("rounded-full border px-4 py-2 text-sm font-semibold", town === "other" ? "border-ink bg-ink text-ink-fg" : "border-dashed border-border bg-surface")}
          >
            Autre lieu…
          </button>
        </div>
        {town === "other" ? (
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-[24px] bg-surface p-4 shadow-card">
            <label className="text-sm font-medium">
              Latitude
              <input name="lat" inputMode="decimal" defaultValue={data.home.lat ?? ""} placeholder="48,1173" className="mt-1 h-11 w-full rounded-2xl border border-border bg-surface px-3" />
            </label>
            <label className="text-sm font-medium">
              Longitude
              <input name="lng" inputMode="decimal" defaultValue={data.home.lng ?? ""} placeholder="-1,6778" className="mt-1 h-11 w-full rounded-2xl border border-border bg-surface px-3" />
            </label>
          </div>
        ) : null}
        <label className="mt-4 block text-sm font-medium">
          Adresse précise <span className="font-normal text-muted">(facultatif, pour affiner plus tard)</span>
          <input name="address" defaultValue={data.home.address ?? ""} placeholder="ex. 10 rue de la Paix" className="mt-1 h-11 w-full rounded-2xl border border-border bg-surface px-3.5" />
        </label>
        <p className="mt-3 text-xs text-muted">Position utilisée : centre de la commune choisie. Vous pourrez saisir l'emplacement exact dans le profil.</p>
      </Step>
    </form>
  );
}

function SectorsStep({ data, pending, onSubmit }: { data: OnboardingData; pending: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const [selected, setSelected] = useState<string[]>(() => {
    const active = data.territories.filter((t) => t.isActive).map((t) => t.code);
    return active.length ? active : data.territories.map((t) => t.code);
  });
  const [extra, setExtra] = useState<{ code: string; name: string }[]>([]);
  const all = [...data.territories.map((t) => ({ code: t.code, name: t.name, color: t.color })), ...extra.map((e) => ({ ...e, color: "#8f88a8" }))];
  const toggle = (code: string) => setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <Step
        title="Quel est votre secteur ?"
        subtitle="Les départements où vous visitez des pharmacies. Chacun aura sa couleur dans le planning et sur la carte."
        illustration={
          <div className="flex gap-2">
            {data.territories.slice(0, 5).map((t, i) => (
              <span key={t.code} className="buddy-pop" style={{ animationDelay: `${i * 60}ms` }}>
                <Buddy mood={(["happy", "joy", "calm", "love", "happy"] as const)[i]!} shape={(["circle", "flower", "squircle", "blob", "bolt"] as const)[i]!} color={(["blue", "yellow", "purple", "pink", "orange"] as const)[i]!} size={56} />
              </span>
            ))}
          </div>
        }
        footer={<ContinueButton pending={pending} />}
      >
        {selected.map((c) => (
          <input key={c} type="hidden" name="codes" value={c} />
        ))}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {all.map((t) => {
            const on = selected.includes(t.code);
            return (
              <button
                key={t.code}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t.code)}
                className={cn(
                  "flex items-center gap-3 rounded-[22px] border-2 p-3 text-left transition",
                  on ? "border-ink bg-surface shadow-card" : "border-transparent bg-surface/60 opacity-70",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white" style={{ backgroundColor: t.color }}>
                  {t.code}
                </span>
                <span className="min-w-0 flex-1 font-semibold">{t.name}</span>
                {on ? <Check className="size-5 shrink-0" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <label className="mt-4 block text-sm font-medium">
          Ajouter un département
          <select
            className="mt-1 h-11 w-full rounded-2xl border border-border bg-surface px-3"
            value=""
            onChange={(e) => {
              const code = e.target.value;
              const name = data.departments.find(([c]) => c === code)?.[1];
              if (!code || !name || all.some((t) => t.code === code)) return;
              setExtra((x) => [...x, { code, name }]);
              setSelected((s) => [...s, code]);
            }}
          >
            <option value="">Choisir…</option>
            {data.departments
              .filter(([code]) => !all.some((t) => t.code === code))
              .map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
          </select>
        </label>
      </Step>
    </form>
  );
}

function WeekStep({ data, pending, onSubmit }: { data: OnboardingData; pending: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const sectors = data.territories.filter((t) => t.isActive);
  const [week, setWeek] = useState<Record<number, string[]>>(() => {
    const w: Record<number, string[]> = {};
    for (const [d] of WEEKDAYS) w[d] = (data.week[d] ?? []).filter((c) => sectors.some((s) => s.code === c));
    return w;
  });
  const toggle = (day: number, code: string) =>
    setWeek((w) => ({ ...w, [day]: w[day]!.includes(code) ? w[day]!.filter((c) => c !== code) : [...w[day]!, code] }));
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <Step
        title="Votre semaine type"
        subtitle="Quel secteur visitez-vous chaque jour ? Léa proposera les créneaux en conséquence. Une variante (Orne / Mayenne) existe aussi, activable semaine par semaine."
        illustration={<CalendarStrip />}
        footer={<ContinueButton pending={pending} />}
      >
        {WEEKDAYS.map(([d]) => (week[d] ?? []).map((c) => <input key={`${d}-${c}`} type="hidden" name={`day${d}`} value={c} />))}
        <div className="space-y-3">
          {WEEKDAYS.map(([d, label]) => (
            <div key={d} className="rounded-[22px] bg-surface p-3 shadow-card">
              <p className="mb-2 font-display text-base font-bold">{label}</p>
              <div className="flex flex-wrap gap-2">
                {sectors.map((s) => {
                  const on = week[d]!.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(d, s.code)}
                      className={cn("rounded-full border-2 px-3 py-1 text-sm font-semibold transition", on ? "text-white" : "border-border bg-surface text-muted")}
                      style={on ? { backgroundColor: s.color, borderColor: s.color } : undefined}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Step>
    </form>
  );
}

function CalendarStrip() {
  const moods = [
    { mood: "happy", shape: "circle", color: "green" },
    { mood: "joy", shape: "flower", color: "yellow" },
    { mood: "calm", shape: "squircle", color: "purple" },
    { mood: "love", shape: "blob", color: "pink" },
    { mood: "sleepy", shape: "blob", color: "blue" },
  ] as const;
  return (
    <div className="flex gap-2">
      {moods.map((m, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <span className="text-xs font-semibold text-muted">{["Lun", "Mar", "Mer", "Jeu", "Ven"][i]}</span>
          <Buddy mood={m.mood} shape={m.shape} color={m.color} size={50} className="buddy-pop" />
        </div>
      ))}
    </div>
  );
}

function Stepper({ name, value, onChange, min, max, step = 1, suffix, tile }: { name: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string; tile: string }) {
  return (
    <div className={cn("pastel-scope flex items-center justify-between rounded-[22px] p-2 text-on-pastel", tile)}>
      <input type="hidden" name={name} value={value} />
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} className="flex size-11 items-center justify-center rounded-full bg-white/70" aria-label="Diminuer">
        <Minus className="size-5" />
      </button>
      <span className="font-display text-2xl font-extrabold tabular-nums">
        {value}
        {suffix ? <span className="ml-1 text-sm font-semibold">{suffix}</span> : null}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} className="flex size-11 items-center justify-center rounded-full bg-white/70" aria-label="Augmenter">
        <Plus className="size-5" />
      </button>
    </div>
  );
}

function TimeTile({ label, name, defaultValue, tile }: { label: string; name: string; defaultValue: string; tile: string }) {
  return (
    <label className={cn("pastel-scope block rounded-[22px] p-4 text-on-pastel", tile)}>
      <span className="text-sm font-semibold">{label}</span>
      <input name={name} type="time" defaultValue={defaultValue.slice(0, 5)} required className="mt-1 block w-full bg-transparent font-display text-3xl font-extrabold focus:outline-none" />
    </label>
  );
}

function RhythmStep({ data, pending, onSubmit }: { data: OnboardingData; pending: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const [visit, setVisit] = useState(data.rhythm.defaultVisitMinutes);
  const [lunch, setLunch] = useState(data.rhythm.lunchMinutes);
  const [buffer, setBuffer] = useState(data.rhythm.bufferMinutes);
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <Step
        title="Votre rythme"
        subtitle="Pour construire des journées réalistes, avec une vraie pause et de la marge pour les imprévus."
        illustration={<Buddy mood="calm" shape="flower" color="green" size={84} animate />}
        footer={<ContinueButton pending={pending} />}
      >
        <div className="grid grid-cols-2 gap-3">
          <TimeTile label="Départ au plus tôt" name="workDayStart" defaultValue={data.rhythm.workDayStart} tile="bg-peach" />
          <TimeTile label="Retour au plus tard" name="workDayEnd" defaultValue={data.rhythm.workDayEnd} tile="bg-lilac" />
          <TimeTile label="Pause déjeuner vers" name="lunchStart" defaultValue={data.rhythm.lunchStart} tile="bg-butter" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">Durée de la pause</p>
            <Stepper name="lunchMinutes" value={lunch} onChange={setLunch} min={0} max={120} step={15} suffix="min" tile="bg-butter" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Durée d'une visite</p>
            <Stepper name="defaultVisitMinutes" value={visit} onChange={setVisit} min={10} max={180} step={5} suffix="min" tile="bg-mint" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Marge entre deux visites</p>
            <Stepper name="bufferMinutes" value={buffer} onChange={setBuffer} min={0} max={60} step={5} suffix="min" tile="bg-sky" />
          </div>
        </div>
      </Step>
    </form>
  );
}

function FrequenciesStep({ data, pending, onSubmit }: { data: OnboardingData; pending: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const [freq, setFreq] = useState(data.frequencies);
  const tiles = { A: "bg-mint", B: "bg-sky", C: "bg-butter", D: "bg-pink" } as const;
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <Step
        title="Combien de visites par an ?"
        subtitle="Selon la catégorie de la pharmacie. Léa en déduit les échéances : une pharmacie vue 4 fois par an est à revoir tous les 91 jours environ."
        illustration={
          <div className="flex gap-2">
            {(["A", "B", "C", "D"] as const).map((c) => (
              <span key={c} className="flex size-14 items-center justify-center rounded-[20px] font-display text-2xl font-extrabold text-white" style={{ backgroundColor: CATEGORY_COLORS[c] }}>
                {c}
              </span>
            ))}
          </div>
        }
        footer={<ContinueButton pending={pending} />}
      >
        <div className="space-y-3">
          {(["A", "B", "C", "D"] as const).map((c) => (
            <div key={c} className="flex items-center gap-3">
              <span
                className="flex size-12 shrink-0 items-center justify-center rounded-[18px] font-display text-xl font-extrabold text-white"
                style={{ backgroundColor: CATEGORY_COLORS[c] }}
                aria-label={`Catégorie ${c}`}
              >
                {c}
              </span>
              <div className="flex-1">
                <Stepper name={`frequency${c}`} value={freq[c]} onChange={(v) => setFreq((f) => ({ ...f, [c]: v }))} min={1} max={24} suffix="/ an" tile={tiles[c]} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Une fréquence individuelle peut aussi être fixée sur chaque fiche pharmacie.</p>
      </Step>
    </form>
  );
}

function RewardsStep({ data, pending, onSubmit }: { data: OnboardingData; pending: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const [on, setOn] = useState(data.gamificationEnabled);
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col">
      <Step
        title="Un peu de jeu ?"
        subtitle="Des points pour chaque visite clôturée, des badges, des petits défis de la semaine et une série douce. Sans classement ni pression : c'est juste pour le plaisir."
        illustration={
          <div className="flex items-end gap-2">
            <Buddy mood="love" shape="flower" color="pink" size={76} animate />
            <div className="flex size-16 items-center justify-center rounded-[22px] bg-butter">
              <Trophy className="size-8 text-on-pastel" aria-hidden />
            </div>
            <Buddy mood="joy" shape="bolt" color="yellow" size={64} />
          </div>
        }
        footer={<ContinueButton pending={pending} />}
      >
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[24px] bg-surface p-5 shadow-card">
          <span>
            <span className="block font-display text-lg font-bold">Activer les récompenses</span>
            <span className="block text-sm text-muted">Désactivable à tout moment dans le profil.</span>
          </span>
          <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
          <span className="relative h-8 w-14 shrink-0 rounded-full bg-border transition peer-checked:bg-accent peer-focus-visible:ring-4 peer-focus-visible:ring-primary/30" aria-hidden>
            <span className={cn("absolute top-1 size-6 rounded-full bg-white shadow transition-all", on ? "left-7" : "left-1")} />
          </span>
        </label>
        <ul className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <li className="rounded-[20px] bg-mint p-3 text-on-pastel">+10 points par visite clôturée</li>
          <li className="rounded-[20px] bg-lilac p-3 text-on-pastel">+15 pour une journée équilibrée</li>
          <li className="rounded-[20px] bg-peach p-3 text-on-pastel">12 badges à collectionner</li>
          <li className="rounded-[20px] bg-sky p-3 text-on-pastel">4 défis doux chaque semaine</li>
        </ul>
      </Step>
    </form>
  );
}

const SLIDES = [
  {
    icon: Sparkles,
    title: "Aujourd'hui",
    text: "Votre prochain rendez-vous, le trajet et un grand bouton « Rendez-vous terminé ». Léa propose aussitôt la date de la visite suivante.",
    buddies: [{ mood: "joy", shape: "flower", color: "yellow" }],
  },
  {
    icon: CalendarDays,
    title: "Des journées qui ont le sourire",
    text: "Chaque journée a son bonhomme : radieux quand elle est équilibrée, grognon quand elle est chargée, en sueur quand elle déborde.",
    buddies: [
      { mood: "happy", shape: "circle", color: "green" },
      { mood: "joy", shape: "flower", color: "yellow" },
      { mood: "meh", shape: "squircle", color: "orange" },
      { mood: "stressed", shape: "triangle", color: "red" },
    ],
  },
  {
    icon: Store,
    title: "Vos pharmacies ont un visage",
    text: "Chaque fiche a son avatar et son humeur : ravie quand le suivi est à jour, inquiète quand elle ne vous a pas vue depuis longtemps.",
    buddies: [
      { mood: "love", shape: "blob", color: "pink" },
      { mood: "worried", shape: "bolt", color: "purple" },
    ],
  },
  {
    icon: FileUp,
    title: "Votre agenda Outlook, reconstruit",
    text: "Importez deux ans d'agenda : Léa reconnaît les pharmacies, valide ce qui est sûr et vous laisse trancher les cas douteux.",
    buddies: [{ mood: "calm", shape: "squircle", color: "blue" }],
  },
  {
    icon: MapIcon,
    title: "Des tournées plus courtes",
    text: "Léa compare l'ordre de vos visites avec un ordre optimisé, explique le gain et n'applique rien sans votre accord.",
    buddies: [
      { mood: "happy", shape: "circle", color: "green" },
      { mood: "happy", shape: "circle", color: "yellow" },
    ],
  },
  {
    icon: Trophy,
    title: "Points, badges et défis",
    text: "Votre jardin grandit à chaque visite clôturée : de la Graine à la Légende, à votre rythme.",
    buddies: [{ mood: "love", shape: "flower", color: "pink" }],
    gamification: true,
  },
] as const;

function Tour({ gamification, onBack, onDone }: { gamification: boolean; onBack: () => void; onDone: () => void }) {
  const slides = SLIDES.filter((s) => !("gamification" in s) || gamification);
  const [i, setI] = useState(0);
  const slide = slides[i]!;
  const last = i === slides.length - 1;
  return (
    <div className="flex min-h-dvh flex-col bg-[#2d5bff] px-5 pt-5 pb-8 text-white">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <header className="flex items-center justify-between">
          <button type="button" onClick={i === 0 ? onBack : () => setI(i - 1)} className="flex size-10 items-center justify-center rounded-full bg-white/15" aria-label="Précédent">
            <ArrowLeft className="size-5" />
          </button>
          <span className="text-sm font-semibold text-white/80">Visite guidée</span>
          <button type="button" onClick={onDone} className="text-sm font-semibold text-white/80 hover:text-white">
            Passer
          </button>
        </header>
        <div key={i} className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <div className="relative mb-8 flex h-56 w-full items-center justify-center">
            <div className="absolute size-52 rounded-full bg-white/10" />
            <div className="absolute size-36 rounded-full bg-white/10" />
            <div className="relative flex items-end gap-2">
              {slide.buddies.map((b, j) => (
                <span key={j} className="buddy-pop" style={{ animationDelay: `${j * 90}ms` }}>
                  <Buddy mood={b.mood} shape={b.shape} color={b.color} size={slide.buddies.length > 2 ? 64 : 104} animate={j === 0} />
                </span>
              ))}
            </div>
            <span className="absolute top-2 right-[18%] flex size-12 items-center justify-center rounded-2xl bg-white text-[#2d5bff] shadow-lg">
              <slide.icon className="size-6" aria-hidden />
            </span>
          </div>
          <h1 className="text-4xl font-extrabold">{slide.title}</h1>
          <p className="mt-3 max-w-sm text-base text-white/85">{slide.text}</p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-2" aria-label={`Diapositive ${i + 1} sur ${slides.length}`}>
            {slides.map((_, j) => (
              <span key={j} className={cn("h-2 rounded-full transition-all", j === i ? "w-6 bg-white" : "w-2 bg-white/40")} />
            ))}
          </div>
          <button
            type="button"
            onClick={last ? onDone : () => setI(i + 1)}
            className="inline-flex h-14 items-center gap-2 rounded-full bg-white px-6 font-semibold text-[#17132b] shadow-lg"
          >
            {last ? "C'est compris" : "Suivant"} <ArrowRight className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DoneStep({ firstName }: { firstName: string }) {
  const actions = [
    { next: "pharmacies", title: "Importer mes pharmacies", text: "Fichier clients Excel, CSV ou FINESS", tile: "bg-peach", icon: Store },
    { next: "agenda", title: "Importer mon agenda Outlook", text: "Deux ans d'historique en fichier .ics", tile: "bg-sky", icon: FileUp },
    { next: "accueil", title: "Découvrir l'accueil", text: "Je ferai les imports plus tard", tile: "bg-mint", icon: Sparkles },
  ] as const;
  return (
    <Step
      title={<>Tout est prêt, {firstName} !</>}
      subtitle="Prochaine étape : donner à Léa vos pharmacies puis votre agenda, pour reconstruire les fiches et l'historique des visites."
      illustration={
        <div className="relative flex h-40 items-center justify-center">
          <Confetti />
          <Buddy mood="joy" shape="flower" color="yellow" size={128} animate label="Bravo !" />
        </div>
      }
    >
      <div className="space-y-3">
        {actions.map((a) => (
          <form key={a.next} action={completeOnboardingAction}>
            <input type="hidden" name="next" value={a.next} />
            <button type="submit" className={cn("pastel-scope flex w-full items-center gap-4 rounded-[24px] p-4 text-left text-on-pastel transition active:scale-[0.99]", a.tile)}>
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/70">
                <a.icon className="size-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-bold">{a.title}</span>
                <span className="block text-sm opacity-80">{a.text}</span>
              </span>
              <ArrowRight className="size-5 shrink-0" aria-hidden />
            </button>
          </form>
        ))}
      </div>
    </Step>
  );
}
