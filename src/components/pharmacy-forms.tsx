"use client";

import { geocodePharmacyAction, updateMetricsAction, updatePharmacyAction, updatePreferencesAction } from "@/server/actions/pharmacies";
import type { ActionResult } from "@/server/actions/result";
import type { Pharmacy, PharmacyMetrics, PharmacyPreferences } from "@/server/db/schema";
import { StatefulForm, SubmitButton } from "./action-form";
import { Checkbox, Field, Input, Select, Textarea } from "./ui/form";

const WEEKDAYS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mer"],
  [4, "Jeu"],
  [5, "Ven"],
  [6, "Sam"],
] as const;

export function IdentityForm({ pharmacy }: { pharmacy: Pharmacy | null }) {
  const p = pharmacy;
  return (
    <div className="space-y-3">
      <StatefulForm action={updatePharmacyAction} className="space-y-3">
        {p ? <input type="hidden" name="id" value={p.id} /> : null}
        <PharmacyIdentityFields pharmacy={p} />
        <SubmitButton>Enregistrer la fiche</SubmitButton>
      </StatefulForm>
      {p ? (
        <StatefulForm action={geocodePharmacyAction}>
          <input type="hidden" name="id" value={p.id} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Géocodage…">
            Géolocaliser depuis l'adresse
          </SubmitButton>
        </StatefulForm>
      ) : null}
    </div>
  );
}

export function PharmacyIdentityFields({ pharmacy: p }: { pharmacy: Pharmacy | null }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom commercial" htmlFor="name">
          <Input id="name" name="name" defaultValue={p?.name} required maxLength={200} />
        </Field>
        <Field label="Raison sociale" htmlFor="legalName">
          <Input id="legalName" name="legalName" defaultValue={p?.legalName ?? ""} maxLength={200} />
        </Field>
      </div>
      <Field label="Adresse" htmlFor="addressLine">
        <Input id="addressLine" name="addressLine" defaultValue={p?.addressLine ?? ""} autoComplete="street-address" />
      </Field>
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Field label="Code postal" htmlFor="postalCode">
          <Input id="postalCode" name="postalCode" defaultValue={p?.postalCode ?? ""} inputMode="numeric" pattern="\d{5}" maxLength={5} />
        </Field>
        <Field label="Commune" htmlFor="city">
          <Input id="city" name="city" defaultValue={p?.city ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Téléphone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={p?.phone ?? ""} />
        </Field>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={p?.email ?? ""} maxLength={200} />
        </Field>
      </div>
      <Field label="Identifiant externe (code client, FINESS…)" htmlFor="externalId">
        <Input id="externalId" name="externalId" defaultValue={p?.externalId ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" htmlFor="lat">
          <Input id="lat" name="lat" defaultValue={p?.lat ?? ""} inputMode="decimal" placeholder="ex. 49,1829" />
        </Field>
        <Field label="Longitude" htmlFor="lng">
          <Input id="lng" name="lng" defaultValue={p?.lng ?? ""} inputMode="decimal" placeholder="ex. -0,3707" />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={p?.notes ?? ""} rows={3} />
      </Field>
    </>
  );
}

export function MetricsForm({ pharmacyId, metrics, categoryFrequency }: { pharmacyId: string; metrics: PharmacyMetrics | null; categoryFrequency: Record<string, number> }) {
  return (
    <StatefulForm action={updateMetricsAction} className="space-y-3">
      <input type="hidden" name="id" value={pharmacyId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catégorie" htmlFor="category" hint="Laissez vide si inconnue.">
          <Select id="category" name="category" defaultValue={metrics?.category ?? ""}>
            <option value="">Inconnue</option>
            {(["A", "B", "C", "D"] as const).map((c) => (
              <option key={c} value={c}>
                {c} — {categoryFrequency[c]} visites/an
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Potentiel" htmlFor="potential">
          <Select id="potential" name="potential" defaultValue={metrics?.potential ?? ""}>
            <option value="">Inconnu</option>
            <option value="fort">Fort</option>
            <option value="moyen">Moyen</option>
            <option value="faible">Faible</option>
          </Select>
        </Field>
        <Field label="Chiffre d'affaires annuel (€)" htmlFor="annualRevenue">
          <Input id="annualRevenue" name="annualRevenue" inputMode="decimal" defaultValue={metrics?.annualRevenue ?? ""} />
        </Field>
        <Field label="Taille" htmlFor="size">
          <Input id="size" name="size" defaultValue={metrics?.size ?? ""} placeholder="ex. 6 salariés" />
        </Field>
      </div>
      <Field label="Fréquence individuelle (visites/an)" htmlFor="targetVisitsPerYear" hint="Prioritaire sur la fréquence de la catégorie. Vide = fréquence de la catégorie.">
        <Input id="targetVisitsPerYear" name="targetVisitsPerYear" inputMode="numeric" defaultValue={metrics?.targetVisitsPerYear ?? ""} />
      </Field>
      <SubmitButton>Enregistrer</SubmitButton>
    </StatefulForm>
  );
}

export function PreferencesForm({ pharmacyId, prefs }: { pharmacyId: string; prefs: PharmacyPreferences | null }) {
  return (
    <StatefulForm action={updatePreferencesAction} className="space-y-3">
      <input type="hidden" name="id" value={pharmacyId} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Jours préférés</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map(([d, l]) => (
            <Checkbox key={d} name="preferredWeekdays" value={d} label={l} defaultChecked={prefs?.preferredWeekdays.includes(d)} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Jours à éviter</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map(([d, l]) => (
            <Checkbox key={d} name="excludedWeekdays" value={d} label={l} defaultChecked={prefs?.excludedWeekdays.includes(d)} />
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-3 gap-3">
        <Field label="À partir de" htmlFor="preferredStart">
          <Input id="preferredStart" name="preferredStart" type="time" defaultValue={prefs?.preferredStart?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="Jusqu'à" htmlFor="preferredEnd">
          <Input id="preferredEnd" name="preferredEnd" type="time" defaultValue={prefs?.preferredEnd?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="Durée (min)" htmlFor="visitMinutes">
          <Input id="visitMinutes" name="visitMinutes" inputMode="numeric" defaultValue={prefs?.visitMinutes ?? ""} />
        </Field>
      </div>
      <Field label="Contraintes du pharmacien" htmlFor="constraints">
        <Textarea id="constraints" name="constraints" rows={2} defaultValue={prefs?.constraints ?? ""} placeholder="ex. jamais pendant l'inventaire de fin de mois" />
      </Field>
      <SubmitButton>Enregistrer</SubmitButton>
    </StatefulForm>
  );
}

export function CreatePharmacyForm({ action }: { action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult> }) {
  return (
    <StatefulForm action={action} className="space-y-3">
      <PharmacyIdentityFields pharmacy={null} />
      <SubmitButton size="lg">Créer la fiche</SubmitButton>
    </StatefulForm>
  );
}
