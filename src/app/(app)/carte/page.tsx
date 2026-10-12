import { and, eq, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { MapExplorer } from "@/components/map/map-explorer";
import { pharmacyMoodSentence } from "@/components/mood-ui";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { isApproximate } from "@/domain/client-data";
import { hasLocation } from "@/domain/geo";
import { formatDayLong, formatDayShort, formatHHmm, isDayKey } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { favoritePlaces, travelPreferences } from "@/server/db/schema";
import { listTerritories } from "@/server/repositories/territories";
import { todayFor } from "@/server/services/context";
import { getPharmacyOverview } from "@/server/services/pharmacy-overview";
import { getPlanning } from "@/server/services/planning";

export const metadata: Metadata = { title: "Carte" };

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const day = sp.date && isDayKey(sp.date) ? sp.date : todayFor(user);
  const [overview, planning, places, travelRows, territories] = await Promise.all([
    getPharmacyOverview(user),
    getPlanning(db, user, day, day),
    db.select().from(favoritePlaces).where(and(eq(favoritePlaces.userId, user.id), isNotNull(favoritePlaces.lat))),
    db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id)),
    listTerritories(db, user.id),
  ]);
  const sectors = territories.filter((t) => t.kind === "department" && t.isActive).map((t) => ({ code: t.code, name: t.name, color: t.color }));
  const travel = travelRows[0];
  const home = travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null;
  const stops = planning[0]!.appointments
    .filter((a) => a.kind === "visit" && a.pharmacy && hasLocation(a.pharmacy))
    .map((a, i) => ({ id: a.id, label: a.title, lat: a.pharmacy!.lat!, lng: a.pharmacy!.lng!, order: i + 1, time: formatHHmm(a.start), pharmacyId: a.pharmacy!.id }));
  const pharmacies = overview
    .filter((i) => hasLocation(i.pharmacy))
    .map((i) => ({
      id: i.pharmacy.id,
      name: i.pharmacy.name,
      city: i.pharmacy.city,
      lat: i.pharmacy.lat!,
      lng: i.pharmacy.lng!,
      category: i.metrics?.category ?? null,
      sectorColor: i.territory?.color ?? null,
      due: i.status.dueState,
      approx: isApproximate(i.pharmacy),
      note: pharmacyMoodSentence(i.status, formatDayShort),
    }));
  const missing = overview.length - pharmacies.length;
  const approximate = pharmacies.filter((p) => p.approx).length;

  return (
    <>
      <PageHeader
        title="Carte"
        subtitle={<span className="capitalize">{formatDayLong(day)}</span>}
        actions={
          <form className="flex items-center gap-2">
            <Input type="date" name="date" defaultValue={day} aria-label="Date" className="h-10 w-auto" />
            <button type="submit" className="h-10 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
              Afficher
            </button>
          </form>
        }
      />
      {missing > 0 || approximate > 0 ? (
        <p className="mb-3 text-sm text-muted">
          {missing > 0 ? `${missing} pharmacie(s) sans coordonnées ne sont pas affichées. ` : ""}
          {approximate > 0 ? `${approximate} pharmacie(s) placée(s) au centre de leur commune (≈, points atténués : position approximative). ` : ""}
          <Link href="/pharmacies" className="text-primary underline">
            Compléter les fiches
          </Link>
        </p>
      ) : null}
      <MapExplorer
        pharmacies={pharmacies}
        stops={stops}
        places={places.map((p) => ({ id: p.id, name: p.name, kind: p.kind, lat: p.lat!, lng: p.lng! }))}
        home={home}
        line={null}
        lineIsEstimate
        sectors={sectors}
      />
      <p className="mt-3 text-xs text-muted">
        Touchez un bonhomme pour ouvrir sa carte ; une bulle regroupe plusieurs pharmacies (pastille rouge : en retard). L&apos;itinéraire
        détaillé s&apos;ouvre dans votre application GPS.
      </p>
    </>
  );
}
