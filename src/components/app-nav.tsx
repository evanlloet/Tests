"use client";

import { BarChart3, CalendarDays, FileUp, GitCompareArrows, Home, Map, Phone, PieChart, Route, Store, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Buddy } from "./buddy";

const PRIMARY = [
  { href: "/", label: "Aujourd'hui", icon: Home },
  { href: "/planning", label: "Planning", icon: CalendarDays },
  { href: "/carte", label: "Carte", icon: Map },
  { href: "/pharmacies", label: "Pharmacies", icon: Store },
  { href: "/profil", label: "Profil", icon: UserRound },
];

const SECONDARY = [
  { href: "/recompenses", label: "Récompenses", icon: Trophy, gamification: true },
  { href: "/tournees", label: "Tournées", icon: Route },
  { href: "/statistiques", label: "Statistiques", icon: PieChart },
  { href: "/imports", label: "Imports Outlook", icon: FileUp },
  { href: "/telephone", label: "RDV téléphoniques", icon: Phone },
  { href: "/rapprochements", label: "Rapprochements", icon: GitCompareArrows },
  { href: "/pilotage", label: "Pilotage", icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ pendingMatches, displayName, gamification, levelName }: { pendingMatches: number; displayName: string; gamification: boolean; levelName: string | null }) {
  const pathname = usePathname();
  const item = (l: { href: string; label: string; icon: typeof Home }, badge?: number) => (
    <Link
      key={l.href}
      href={l.href}
      aria-current={isActive(pathname, l.href) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors",
        isActive(pathname, l.href) ? "bg-ink text-ink-fg" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      <l.icon className="size-5" aria-hidden />
      <span className="flex-1">{l.label}</span>
      {badge ? <span className="rounded-full bg-coral px-2 text-xs font-bold text-on-pastel">{badge}</span> : null}
    </Link>
  );
  return (
    <nav aria-label="Navigation principale" className="flex h-full flex-col gap-1 p-4">
      <Link href="/" className="mb-5 flex items-center gap-3 px-1 pt-1">
        <Buddy mood="joy" shape="flower" color="yellow" size={44} className="buddy-hover" />
        <span>
          <span className="block font-display text-xl leading-tight font-extrabold">Léa</span>
          <span className="block text-xs text-muted">
            Bonjour {displayName}
            {gamification && levelName ? ` · ${levelName}` : ""}
          </span>
        </span>
      </Link>
      {PRIMARY.map((l) => item(l))}
      <div className="my-3 border-t border-border" />
      {SECONDARY.filter((l) => !("gamification" in l) || gamification).map((l) => item(l, l.href === "/rapprochements" ? pendingMatches : undefined))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-3 pb-2 lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5 rounded-[28px] border border-border/70 bg-surface/95 p-1.5 shadow-[0_8px_30px_rgb(23_19_43/0.12)] backdrop-blur">
        {PRIMARY.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-semibold transition-colors",
                  active ? "bg-ink text-ink-fg" : "text-muted",
                )}
              >
                <l.icon className="size-5.5" aria-hidden />
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
