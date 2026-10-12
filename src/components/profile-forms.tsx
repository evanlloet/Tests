"use client";

import {
  addFavoritePlaceAction,
  addTerritoryAction,
  geocodeHomeAction,
  updateSettingsAction,
  updateTravelAction,
} from "@/server/actions/profile";
import { StatefulForm, SubmitButton } from "./action-form";
import { Checkbox, Field, Input, Select, Textarea } from "./ui/form";

export type SettingsValues = {
  displayName: string;
  workDayStart: string;
  workDayEnd: string;
  lunchStart: string;
  lunchMinutes: number;
  defaultVisitMinutes: number;
  bufferMinutes: number;
  frequencyA: number;
  frequencyB: number;
  frequencyC: number;
  frequencyD: number;
  autoMatchThreshold: number;
};

export function SettingsForm({ values }: { values: SettingsValues }) {
  return (
    <StatefulForm action={updateSettingsAction} className="space-y-4">
      <Field label="Prénom" htmlFor="displayName">
        <Input id="displayName" name="displayName" defaultValue={values.displayName} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Début de journée (départ)" htmlFor="workDayStart">
          <Input id="workDayStart" name="workDayStart" type="time" defaultValue={values.workDayStart.slice(0, 5)} required />
        </Field>
        <Field label="Fin de journée (retour)" htmlFor="workDayEnd">
          <Input id="workDayEnd" name="workDayEnd" type="time" defaultValue={values.workDayEnd.slice(0, 5)} required />
        </Field>
        <Field label="Pause déjeuner à partir de" htmlFor="lunchStart">
          <Input id="lunchStart" name="lunchStart" type="time" defaultValue={values.lunchStart.slice(0, 5)} required />
        </Field>
        <Field label="Durée de la pause (min)" htmlFor="lunchMinutes">
          <Input id="lunchMinutes" name="lunchMinutes" inputMode="numeric" defaultValue={values.lunchMinutes} required />
        </Field>
        <Field label="Durée d'une visite (min)" htmlFor="defaultVisitMinutes">
          <Input id="defaultVisitMinutes" name="defaultVisitMinutes" inputMode="numeric" defaultValue={values.defaultVisitMinutes} required />
        </Field>
        <Field label="Temps tampon après visite (min)" htmlFor="bufferMinutes">
          <Input id="bufferMinutes" name="bufferMinutes" inputMode="numeric" defaultValue={values.bufferMinutes} required />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Visites par an selon la catégorie</legend>
        <div className="grid grid-cols-4 gap-3">
          {(["A", "B", "C", "D"] as const).map((c) => (
            <Field key={c} label={c} htmlFor={`frequency${c}`}>
              <Input id={`frequency${c}`} name={`frequency${c}`} inputMode="numeric" defaultValue={values[`frequency${c}`]} required />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field
        label="Seuil de validation automatique des rapprochements"
        htmlFor="autoMatchThreshold"
        hint="Entre 0,6 et 1. Au-dessous de ce score, chaque rapprochement est soumis à votre validation. 1 = tout valider manuellement."
      >
        <Input id="autoMatchThreshold" name="autoMatchThreshold" inputMode="decimal" defaultValue={values.autoMatchThreshold} required />
      </Field>
      <SubmitButton>Enregistrer</SubmitButton>
    </StatefulForm>
  );
}

export type TravelValues = {
  homeLabel: string;
  homeAddress: string | null;
  homeLat: number | null;
  homeLng: number | null;
  maxDailyDriveMinutes: number;
  hotelThresholdKm: number;
  estimateSpeedKmh: number;
  estimateRoadFactor: number;
  mustReturnHomeWeekdays: number[];
};

export function TravelForm({ values, geocoder }: { values: TravelValues; geocoder: boolean }) {
  return (
    <div className="space-y-3">
      <StatefulForm action={updateTravelAction} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom du point de départ" htmlFor="homeLabel">
            <Input id="homeLabel" name="homeLabel" defaultValue={values.homeLabel} required />
          </Field>
          <Field label="Adresse du domicile" htmlFor="homeAddress">
            <Input id="homeAddress" name="homeAddress" defaultValue={values.homeAddress ?? ""} placeholder="ex. 1 place de la Mairie, 35000 Rennes" />
          </Field>
          <Field label="Latitude" htmlFor="homeLat">
            <Input id="homeLat" name="homeLat" inputMode="decimal" defaultValue={values.homeLat ?? ""} placeholder="ex. 48,1173" />
          </Field>
          <Field label="Longitude" htmlFor="homeLng">
            <Input id="homeLng" name="homeLng" inputMode="decimal" defaultValue={values.homeLng ?? ""} placeholder="ex. -1,6778" />
          </Field>
          <Field label="Conduite maximale par jour (min)" htmlFor="maxDailyDriveMinutes">
            <Input id="maxDailyDriveMinutes" name="maxDailyDriveMinutes" inputMode="numeric" defaultValue={values.maxDailyDriveMinutes} required />
          </Field>
          <Field label="Distance au-delà de laquelle une nuit d'hôtel est envisagée (km)" htmlFor="hotelThresholdKm">
            <Input id="hotelThresholdKm" name="hotelThresholdKm" inputMode="numeric" defaultValue={values.hotelThresholdKm} required />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Retour au domicile obligatoire le soir</legend>
          <div className="flex flex-wrap gap-3">
            {[
              [1, "Lun"],
              [2, "Mar"],
              [3, "Mer"],
              [4, "Jeu"],
              [5, "Ven"],
            ].map(([d, l]) => (
              <Checkbox key={d} name="mustReturnHomeWeekdays" value={d} label={l} defaultChecked={values.mustReturnHomeWeekdays.includes(Number(d))} />
            ))}
          </div>
        </fieldset>
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Paramètres de l&apos;estimation sans moteur de routage</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Vitesse longue distance (km/h)" htmlFor="estimateSpeedKmh">
              <Input id="estimateSpeedKmh" name="estimateSpeedKmh" inputMode="numeric" defaultValue={values.estimateSpeedKmh} required />
            </Field>
            <Field label="Coefficient de détour" htmlFor="estimateRoadFactor" hint="Distance routière ≈ vol d'oiseau × coefficient.">
              <Input id="estimateRoadFactor" name="estimateRoadFactor" inputMode="decimal" defaultValue={values.estimateRoadFactor} required />
            </Field>
          </div>
        </details>
        <SubmitButton>Enregistrer</SubmitButton>
      </StatefulForm>
      {geocoder ? (
        <StatefulForm action={geocodeHomeAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="homeAddress" value={values.homeAddress ?? ""} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Géocodage…" disabled={!values.homeAddress}>
            Géolocaliser l&apos;adresse enregistrée
          </SubmitButton>
        </StatefulForm>
      ) : null}
    </div>
  );
}

export function AddTerritoryForm({ departments }: { departments: [string, string][] }) {
  return (
    <StatefulForm action={addTerritoryAction} className="flex flex-wrap items-end gap-2">
      <Field label="Ajouter un département" htmlFor="code">
        <Select id="code" name="code" className="w-56">
          {departments.map(([code, name]) => (
            <option key={code} value={code}>
              {code} — {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Couleur" htmlFor="color">
        <Input id="color" name="color" type="color" defaultValue="#0891b2" className="w-16 p-1" />
      </Field>
      <SubmitButton variant="secondary">Ajouter</SubmitButton>
    </StatefulForm>
  );
}

export function FavoritePlaceForm() {
  return (
    <StatefulForm action={addFavoritePlaceAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Type" htmlFor="kind">
          <Select id="kind" name="kind">
            <option value="hotel">Hôtel</option>
            <option value="restaurant">Restaurant</option>
            <option value="pool">Piscine</option>
            <option value="other">Autre</option>
          </Select>
        </Field>
        <Field label="Nom" htmlFor="placeName">
          <Input id="placeName" name="name" required />
        </Field>
      </div>
      <Field label="Adresse" htmlFor="address" hint="Géolocalisée automatiquement si un service de géocodage est configuré.">
        <Input id="address" name="address" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" htmlFor="placeLat">
          <Input id="placeLat" name="lat" inputMode="decimal" />
        </Field>
        <Field label="Longitude" htmlFor="placeLng">
          <Input id="placeLng" name="lng" inputMode="decimal" />
        </Field>
        <Field label="Prix habituel" htmlFor="priceNote">
          <Input id="priceNote" name="priceNote" placeholder="ex. 85 € la nuit" />
        </Field>
        <Field label="Lien (réservation, site)" htmlFor="url">
          <Input id="url" name="url" type="url" placeholder="https://" />
        </Field>
      </div>
      <Field label="Notes personnelles" htmlFor="placeNotes">
        <Textarea id="placeNotes" name="notes" rows={2} />
      </Field>
      <SubmitButton variant="secondary">Enregistrer le lieu</SubmitButton>
    </StatefulForm>
  );
}
