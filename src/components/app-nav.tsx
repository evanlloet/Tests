"use client";

import { BarChart3, CalendarDays, FileUp, GitCompareArrows, Home, Map, Route, Store, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const PRIMARY = [
  { href: "/", label: "Aujourd'hui", icon: Home },
  { href: "/planning", label: "Planning", icon: CalendarDays },
  { href: "/carte", label: "Carte", icon: Map },
  { href: "/pharmacies", label: "Pharmacies", icon: Store },
  { href: "/profil", label: "Profil", icon: UserRound },
];

const SECONDARY = [
  { href: "/tournees", label: "Tournées", icon: Route },
  { href: "/imports", label: "Imports Outlook", icon: FileUp },
  { href: "/rapprochements", label: "Rapprochements", icon: GitCompareArrows },
  { href: "/pilotage", label: "Pilotage", icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ pendingMatches, displayName }: { pendingMatches: number; displayName: string }) {
  const pathname = usePathname();
  const item = (l: (typeof PRIMARY)[number], badge?: number) => (
    <Link
      key={l.href}
      href={l.href}
      aria-current={isActive(pathname, l.href) ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        isActive(pathname, l.href) ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      <l.icon className="size-5" aria-hidden />
      <span className="flex-1">{l.label}</span>
      {badge ? <span className="rounded-full bg-warning px-2 text-xs font-semibold text-surface">{badge}</span> : null}
    </Link>
  );
  return (
    <nav aria-label="Navigation principale" className="flex h-full flex-col gap-1 p-3">
      <Link href="/" className="mb-4 flex items-center gap-3 px-2 pt-2">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-fg">L</span>
        <span>
          <span className="block font-semibold leading-tight">Léa</span>
          <span className="block text-xs text-muted">Bonjour {displayName}</span>
        </span>
      </Link>
      {PRIMARY.map((l) => item(l))}
      <div className="my-3 border-t border-border" />
      {SECONDARY.map((l) => item(l, l.href === "/rapprochements" ? pendingMatches : undefined))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {PRIMARY.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted",
                )}
              >
                <l.icon className={cn("size-6", active && "stroke-[2.4]")} aria-hidden />
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
