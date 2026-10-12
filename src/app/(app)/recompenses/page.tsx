import { Archive, Compass, Flame, Footprints, Heart, Leaf, Map as MapIcon, PenLine, Search, Sun, Tags, Trophy, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { Buddy } from "@/components/buddy";
import { ProgressBar, ProgressRing } from "@/components/mood-ui";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Tile, pastelClass } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { encouragement, LEVELS, type Badge } from "@/domain/gamification";
import type { BuddyColor, BuddyShape, Mood } from "@/domain/mood";
import { cn } from "@/lib/cn";
import { setGamificationAction } from "@/server/actions/profile";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getRewards } from "@/server/services/rewards";

export const metadata: Metadata = { title: "Récompenses" };

const ICONS: Record<Badge["icon"], LucideIcon> = {
  footprints: Footprints,
  archive: Archive,
  search: Search,
  map: MapIcon,
  tags: Tags,
  pen: PenLine,
  flame: Flame,
  leaf: Leaf,
  compass: Compass,
  sun: Sun,
  heart: Heart,
  trophy: Trophy,
};

/** Chaque niveau du jardin a son bonhomme (qui grandit et s'épanouit). */
const LEVEL_BUDDIES: { mood: Mood; shape: BuddyShape; color: BuddyColor }[] = [
  { mood: "sleepy", shape: "circle", color: "gray" },
  { mood: "happy", shape: "blob", color: "green" },
  { mood: "happy", shape: "squircle", color: "green" },
  { mood: "happy", shape: "flower", color: "pink" },
  { mood: "joy", shape: "flower", color: "purple" },
  { mood: "joy", shape: "flower", color: "yellow" },
  { mood: "love", shape: "blob", color: "green" },
  { mood: "love", shape: "bolt", color: "yellow" },
];

export default async function RewardsPage() {
  const user = await requireUser();
  if (!user.gamificationEnabled) {
    return (
      <>
        <PageHeader title="Récompenses" />
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
            <Buddy mood="sleepy" shape="flower" color="purple" size={96} />
            <p className="font-display text-2xl font-bold">Les récompenses sont en pause</p>
            <p className="max-w-md text-muted">Points, badges et défis sont facultatifs. Vous pouvez les réactiver quand vous voulez, vos progrès sont recalculés à partir de vos données.</p>
            <form action={setGamificationAction}>
              <input type="hidden" name="enabled" value="on" />
              <Button type="submit" size="lg">
                Réactiver les récompenses
              </Button>
            </form>
          </CardBody>
        </Card>
      </>
    );
  }

  const r = await getRewards(db, user);
  const levelBuddy = LEVEL_BUDDIES[r.level.index]!;
  const unlocked = r.badges.filter((b) => b.unlocked).length;

  return (
    <>
      <PageHeader title="Récompenses" subtitle={encouragement(r)} />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Tile color="butter" className="relative overflow-hidden p-6">
          <div className="flex items-center gap-5">
            <ProgressRing value={r.level.progress} size={132} stroke={10} color="#17132b">
              <Buddy mood={levelBuddy.mood} shape={levelBuddy.shape} color={levelBuddy.color} size={84} animate />
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-sm font-semibold opacity-75">Niveau {r.level.index + 1} sur {LEVELS.length}</p>
              <p className="font-display text-4xl font-extrabold">{r.level.name}</p>
              <p className="mt-1 font-display text-2xl font-bold">{r.points.toLocaleString("fr-FR")} points</p>
              <p className="mt-1 text-sm">
                {r.level.nextMin ? `Encore ${(r.level.nextMin - r.points).toLocaleString("fr-FR")} points pour devenir ${r.level.nextName}.` : "Niveau maximal atteint, bravo !"}
              </p>
            </div>
          </div>
          <ol className="mt-6 flex items-end justify-between gap-1" aria-label="Les niveaux du jardin">
            {LEVELS.map((l, i) => {
              const b = LEVEL_BUDDIES[i]!;
              const reached = i <= r.level.index;
              return (
                <li key={l.name} className="flex min-w-0 flex-col items-center gap-1" title={`${l.name} (${l.min} points)`}>
                  <Buddy mood={reached ? b.mood : "sleepy"} shape={b.shape} color={reached ? b.color : "gray"} size={22 + i * 3} className={reached ? "" : "opacity-40"} />
                  <span className={cn("hidden truncate text-[10px] font-semibold sm:block", !reached && "opacity-50")}>{l.name}</span>
                </li>
              );
            })}
          </ol>
        </Tile>

        <div className="grid grid-cols-2 gap-3">
          <Tile color="peach" className="flex flex-col justify-between">
            <p className="text-sm font-semibold">Série douce</p>
            <p className="flex items-center gap-1 font-display text-5xl font-extrabold">
              <Flame className="size-9" aria-hidden /> {r.streak.current}
            </p>
            <p className="text-xs opacity-75">journées de visites clôturées d'affilée · record {r.streak.best}. Les jours sans visite ne la cassent pas.</p>
          </Tile>
          <Tile color="lilac" className="flex flex-col justify-between">
            <p className="text-sm font-semibold">Badges</p>
            <p className="font-display text-5xl font-extrabold">
              {unlocked}
              <span className="text-2xl">/{r.badges.length}</span>
            </p>
            <p className="text-xs opacity-75">à collectionner, à votre rythme</p>
          </Tile>
          <Tile color="mint" className="col-span-2">
            <p className="text-sm font-semibold">Aujourd'hui</p>
            <p className="font-display text-3xl font-extrabold">+{r.todayPoints} points</p>
            <p className="text-xs opacity-75">Visites clôturées, comptes rendus et journée équilibrée comptent.</p>
          </Tile>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-2xl font-extrabold">Défis de la semaine</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {r.challenges.map((c) => (
            <Tile key={c.key} color={c.color} className={cn("relative p-5", c.done && "ring-2 ring-on-pastel")}>
              {c.done ? (
                <span className="absolute top-3 right-3 rounded-full bg-on-pastel px-2 py-0.5 text-xs font-bold text-white">Réussi !</span>
              ) : null}
              <p className="pr-14 font-display text-lg leading-tight font-bold">{c.label}</p>
              <div className="mt-4 flex items-center gap-3">
                <ProgressBar value={c.value} target={c.target} className="flex-1 bg-white/60" />
                <span className="text-sm font-bold tabular-nums">
                  {c.value}/{c.target}
                </span>
              </div>
            </Tile>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-2xl font-extrabold">Badges</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {r.badges.map((b) => {
            const Icon = ICONS[b.icon];
            return (
              <li
                key={b.key}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-[24px] p-4 text-center",
                  b.unlocked ? `${pastelClass(b.color)} text-on-pastel` : "border-2 border-dashed border-border bg-surface",
                )}
              >
                <span className={cn("flex size-14 items-center justify-center rounded-full", b.unlocked ? "bg-white/80 shadow-card" : "bg-surface-2 text-muted")}>
                  <Icon className="size-7" aria-hidden />
                </span>
                <span className="font-display text-base font-bold">{b.name}</span>
                <span className={cn("text-xs", b.unlocked ? "opacity-80" : "text-muted")}>{b.description}</span>
                {b.unlocked ? (
                  <span className="rounded-full bg-on-pastel px-2.5 py-0.5 text-xs font-bold text-white">Débloqué</span>
                ) : (
                  <div className="flex w-full items-center gap-2">
                    <ProgressBar value={b.value} target={b.target} className="flex-1 bg-surface-2" color="bg-primary" />
                    <span className="text-xs text-muted tabular-nums">
                      {b.value}/{b.target}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="D'où viennent vos points ?" description="Recalculés à partir de vos données : rien n'est stocké à part, rien n'est classé ni partagé." />
          <CardBody>
            <ul className="divide-y divide-border text-sm">
              {r.breakdown.map((b) => (
                <li key={b.label} className="flex items-center justify-between py-2">
                  <span>{b.label}</span>
                  <span className="font-display font-bold tabular-nums">{b.points.toLocaleString("fr-FR")}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sans pression" description="Les récompenses sont un petit plus, pas un objectif. Vous pouvez les mettre en pause à tout moment." />
          <CardBody>
            <form action={setGamificationAction}>
              <Button type="submit" variant="secondary">
                Mettre les récompenses en pause
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
