import { asc, eq } from "drizzle-orm";
import { ExternalLink, LogOut } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DeleteAccountForm } from "@/components/delete-account";
import { AddTerritoryForm, FavoritePlaceForm, SettingsForm, TravelForm } from "@/components/profile-forms";
import { Badge, SectorDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Buddy } from "@/components/buddy";
import { Card, CardBody, CardHeader, Tile } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { WeekTemplateEditor } from "@/components/week-template-editor";
import { DEPARTMENTS } from "@/domain/departments";
import { formatDateTime } from "@/domain/time";
import { geocoderConfigured } from "@/integrations/geocoding/geoplateforme";
import { routingStatus } from "@/integrations/routing";
import { logoutAction } from "@/server/actions/auth";
import { restartOnboardingAction } from "@/server/actions/onboarding";
import { deleteFavoritePlaceAction, setGamificationAction, setThemeAction, testRoutingAction } from "@/server/actions/profile";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { favoritePlaces } from "@/server/db/schema";
import { countPendingMatches } from "@/server/repositories/matches";
import { countPharmacies } from "@/server/repositories/pharmacies";
import { listTerritories, listWeekTemplates } from "@/server/repositories/territories";
import { getUserSettings } from "@/server/repositories/users";

export const metadata: Metadata = { title: "Profil et préférences" };

const PLACE_LABEL = { hotel: "Hôtel", restaurant: "Restaurant", pool: "Piscine", other: "Autre" } as const;

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { user: u, travel } = await getUserSettings(db, user.id);
  const territories = await listTerritories(db, user.id);
  const templates = await listWeekTemplates(db, user.id);
  const places = await db.select().from(favoritePlaces).where(eq(favoritePlaces.userId, user.id)).orderBy(asc(favoritePlaces.kind), asc(favoritePlaces.name));
  const pharmacyCount = await countPharmacies(db, user.id);
  const pending = await countPendingMatches(user.id);
  const routing = routingStatus();
  const theme = (await cookies()).get("lea_theme")?.value ?? "system";
  const usedCodes = new Set(territories.map((t) => t.code));
  const homeSet = travel?.homeLat !== null && travel?.homeLat !== undefined;

  const steps = [
    { done: homeSet, label: "Renseigner le domicile (point de départ des tournées)", href: "#deplacements" },
    { done: pharmacyCount > 0, label: "Importer le fichier des pharmacies", href: "/pharmacies/import" },
    { done: false, label: "Importer l'historique Outlook (2 ans)", href: "/imports" },
    { done: pharmacyCount > 0 && pending === 0, label: "Vérifier les rapprochements incertains", href: "/rapprochements" },
  ];

  return (
    <>
      <Tile color="lilac" className="mb-4 flex items-center gap-4 p-5">
        <Buddy mood="happy" shape="flower" color="yellow" size={72} className="buddy-hover" />
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold">{u.displayName}</h1>
          <p className="truncate text-sm opacity-75">{u.email}</p>
          {user.gamificationEnabled ? (
            <Link href="/recompenses" className="mt-1 inline-block text-sm font-semibold underline">
              Voir mes récompenses
            </Link>
          ) : null}
        </div>
      </Tile>
      {sp.bienvenue ? (
        <Notice tone="success" title="Votre espace est prêt" className="mb-4">
          Le territoire (Calvados, Manche, Orne, Ille-et-Vilaine, Mayenne) et les deux modèles de semaine du brief sont déjà configurés.
          Étapes suivantes :
        </Notice>
      ) : null}
      <Card className="mb-4">
        <CardHeader title="Mise en route" />
        <CardBody>
          <ol className="space-y-2 text-sm">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-success text-surface" : "bg-surface-2 text-muted"}`}>
                  {s.done ? "✓" : i + 1}
                </span>
                <Link href={s.href} className={s.done ? "text-muted line-through" : "font-medium text-primary underline-offset-4 hover:underline"}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
          <nav className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4 text-sm lg:hidden" aria-label="Autres écrans">
            {[
              ...(user.gamificationEnabled ? [["/recompenses", "Récompenses"]] : []),
              ["/assistant", "Assistant"],
              ["/statistiques", "Statistiques"],
              ["/tournees", "Tournées"],
              ["/imports", "Imports Outlook"],
              ["/telephone", "RDV téléphoniques"],
              ["/rapprochements", `Rapprochements${pending ? ` (${pending})` : ""}`],
              ["/pilotage", "Pilotage"],
            ].map(([href, label]) => (
              <Link key={href} href={href!} className="rounded-full border border-border px-4 py-2 font-semibold hover:bg-surface-2">
                {label}
              </Link>
            ))}
          </nav>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 *:min-w-0 xl:grid-cols-2">
        <Card>
          <CardHeader title="Journée de travail et règles de visite" />
          <CardBody>
            <SettingsForm
              values={{
                displayName: u.displayName,
                workDayStart: u.workDayStart,
                workDayEnd: u.workDayEnd,
                lunchStart: u.lunchStart,
                lunchMinutes: u.lunchMinutes,
                defaultVisitMinutes: u.defaultVisitMinutes,
                bufferMinutes: u.bufferMinutes,
                frequencyA: u.frequencyA,
                frequencyB: u.frequencyB,
                frequencyC: u.frequencyC,
                frequencyD: u.frequencyD,
                autoMatchThreshold: u.autoMatchThreshold,
              }}
            />
          </CardBody>
        </Card>
        <Card id="deplacements">
          <CardHeader title="Déplacements et domicile" />
          <CardBody>
            <TravelForm
              geocoder={geocoderConfigured()}
              values={{
                homeLabel: travel?.homeLabel ?? "Domicile",
                homeAddress: travel?.homeAddress ?? null,
                homeLat: travel?.homeLat ?? null,
                homeLng: travel?.homeLng ?? null,
                maxDailyDriveMinutes: travel?.maxDailyDriveMinutes ?? 300,
                hotelThresholdKm: travel?.hotelThresholdKm ?? 150,
                estimateSpeedKmh: travel?.estimateSpeedKmh ?? 90,
                estimateRoadFactor: travel?.estimateRoadFactor ?? 1.25,
                mustReturnHomeWeekdays: travel?.mustReturnHomeWeekdays ?? [5],
              }}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Secteurs par jour"
          description="Modèles de semaine utilisés pour proposer les créneaux et signaler les visites hors secteur. Le modèle actif se choisit semaine par semaine dans le planning."
        />
        <CardBody className="grid grid-cols-1 gap-4 *:min-w-0 xl:grid-cols-2">
          {templates.map((t) => (
            <WeekTemplateEditor key={t.id} template={t} territories={territories.filter((x) => x.kind === "department")} />
          ))}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Territoire" description="Départements couverts. D'autres pourront être ajoutés sans modifier l'application." />
          <CardBody className="space-y-4">
            <ul className="flex flex-wrap gap-2">
              {territories.map((t) => (
                <li key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-sm">
                  <SectorDot color={t.color} /> {t.name} <span className="text-xs text-muted">{t.code}</span>
                </li>
              ))}
            </ul>
            <AddTerritoryForm departments={Object.entries(DEPARTMENTS).filter(([code]) => !usedCodes.has(code))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Hôtels, restaurants et piscines" description="Utilisés comme points de départ/arrivée des tournées et affichés sur la carte. Aucune réservation automatique." />
          <CardBody className="space-y-4">
            {places.length ? (
              <ul className="divide-y divide-border text-sm">
                {places.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <Badge tone="accent" className="mr-1.5">
                          {PLACE_LABEL[p.kind]}
                        </Badge>
                        {p.name}
                      </p>
                      <p className="text-xs text-muted">
                        {[p.address, p.priceNote, p.lat === null ? "non géolocalisé" : null].filter(Boolean).join(" · ")}
                      </p>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
                          Site / réservation <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                    <ActionForm action={deleteFavoritePlaceAction} feedback={false}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-danger">
                        Supprimer
                      </Button>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Aucun lieu enregistré.</p>
            )}
            <FavoritePlaceForm />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Connexions et services" description="État réel des intégrations sur cette installation." />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium">Calcul d&apos;itinéraires</dt>
                <dd className="text-muted">
                  {routing.configured
                    ? `${routing.label}. Trajets mis en cache ; repli automatique sur l'estimation à vol d'oiseau si le service ne répond pas.`
                    : `${routing.label} (ROUTING_PROVIDER=estimate).`}
                  {routing.lastSuccessAt ? ` Dernière réponse : ${formatDateTime(routing.lastSuccessAt, user.timezone)}.` : ""}
                  {routing.lastError ? ` Dernier échec : ${routing.lastError}.` : ""}
                </dd>
                {routing.configured ? (
                  <ActionForm action={testRoutingAction} className="mt-2">
                    <SubmitButton size="sm" variant="secondary" pendingLabel="Test en cours…">
                      Tester le calcul d&apos;itinéraire
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
              <div>
                <dt className="font-medium">Géocodage</dt>
                <dd className="text-muted">{geocoderConfigured() ? "Géoplateforme IGN configurée (utilisée à la demande)." : "Non configuré : saisie manuelle des coordonnées."}</dd>
              </div>
              <div>
                <dt className="font-medium">Outlook</dt>
                <dd className="text-muted">Import de fichiers ICS / CSV. Synchronisation Microsoft Graph : non disponible dans cette version.</dd>
              </div>
              <div>
                <dt className="font-medium">Fond de carte</dt>
                <dd className="text-muted">{process.env.NEXT_PUBLIC_MAP_RASTER_TILES ? "Tuiles Plan IGN (Géoplateforme)." : "Aucun service de tuiles configuré."}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Affichage et session" />
          <CardBody className="space-y-4">
            <form action={setThemeAction} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Thème :</span>
              {[
                ["system", "Système"],
                ["light", "Clair"],
                ["dark", "Sombre"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="submit"
                  name="theme"
                  value={value}
                  aria-pressed={theme === value}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${theme === value ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2"}`}
                >
                  {label}
                </button>
              ))}
            </form>
            <form action={setGamificationAction} className="flex items-center justify-between gap-3 rounded-[20px] bg-surface-2 p-3">
              <span className="text-sm">
                <span className="block font-semibold">Récompenses (points, badges, défis)</span>
                <span className="block text-xs text-muted">{user.gamificationEnabled ? "Activées" : "En pause"} · facultatives, sans classement</span>
              </span>
              {user.gamificationEnabled ? null : <input type="hidden" name="enabled" value="on" />}
              <button type="submit" className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-semibold hover:bg-surface-2">
                {user.gamificationEnabled ? "Mettre en pause" : "Activer"}
              </button>
            </form>
            <form action={restartOnboardingAction}>
              <button type="submit" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                Rejouer l'accueil et la visite guidée
              </button>
            </form>
            <form action={logoutAction}>
              <SubmitButtonLogout />
            </form>
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm font-medium">Vos données</p>
              <p className="text-xs text-muted">
                Toutes vos données sont stockées dans la base de l&apos;application, isolées par compte. Vous pouvez les exporter à tout moment
                (fichier JSON) ou les supprimer définitivement.
              </p>
              <a href="/api/export" className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-surface-2">
                Exporter mes données
              </a>
              <DeleteAccountForm />
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function SubmitButtonLogout() {
  return (
    <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold hover:bg-surface-2">
      <LogOut className="size-4" aria-hidden /> Se déconnecter
    </button>
  );
}
