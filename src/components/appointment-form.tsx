"use client";

import { useState } from "react";
import { saveAppointmentAction } from "@/server/actions/appointments";
import { StatefulForm, SubmitButton } from "./action-form";
import { PharmacyPicker, type PickerOption } from "./pharmacy-picker";
import { Checkbox, Field, Input, Select, Textarea } from "./ui/form";

export type AppointmentFormValues = {
  id?: string;
  pharmacyId: string | null;
  kind: "visit" | "unavailable" | "other";
  title: string;
  day: string;
  start: string;
  end: string;
  status: "proposed" | "pending" | "confirmed" | "cancelled";
  notes: string;
};

function addMinutes(hhmm: string, minutes: number) {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function AppointmentForm({
  values,
  options,
  defaultVisitMinutes,
}: {
  values: AppointmentFormValues;
  options: PickerOption[];
  defaultVisitMinutes: number;
}) {
  const [kind, setKind] = useState(values.kind);
  const [start, setStart] = useState(values.start);
  const [end, setEnd] = useState(values.end);
  const wasConfirmed = Boolean(values.id) && values.status === "confirmed";

  return (
    <StatefulForm action={saveAppointmentAction} className="space-y-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Type" htmlFor="kind">
        <Select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="visit">Visite en pharmacie</option>
          <option value="unavailable">Indisponibilité</option>
          <option value="other">Autre rendez-vous</option>
        </Select>
      </Field>
      {kind === "visit" ? (
        <Field label="Pharmacie">
          <PharmacyPicker options={options} defaultValue={values.pharmacyId} required />
        </Field>
      ) : null}
      <Field label={kind === "visit" ? "Titre (facultatif)" : "Titre"} htmlFor="title">
        <Input id="title" name="title" defaultValue={values.title} maxLength={200} placeholder={kind === "unavailable" ? "ex. Formation, congés…" : ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="day" className="col-span-2 sm:col-span-1">
          <Input id="day" name="day" type="date" defaultValue={values.day} required />
        </Field>
        <Field label="Début" htmlFor="start">
          <Input
            id="start"
            name="start"
            type="time"
            step={300}
            value={start}
            onChange={(e) => {
              const delta = (() => {
                const [sh = 0, sm = 0] = start.split(":").map(Number);
                const [eh = 0, em = 0] = end.split(":").map(Number);
                return eh * 60 + em - (sh * 60 + sm);
              })();
              setStart(e.target.value);
              setEnd(addMinutes(e.target.value, delta > 0 ? delta : defaultVisitMinutes));
            }}
            required
          />
        </Field>
        <Field label="Fin" htmlFor="end">
          <Input id="end" name="end" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
      </div>
      <Field label="Statut" htmlFor="status" hint="Proposé : suggéré, pas encore convenu · En attente : demandé au pharmacien · Confirmé : convenu.">
        <Select id="status" name="status" defaultValue={values.status}>
          <option value="confirmed">Confirmé</option>
          <option value="pending">En attente de confirmation</option>
          <option value="proposed">Proposé</option>
          <option value="cancelled">Annulé</option>
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={values.notes} rows={3} />
      </Field>
      {wasConfirmed ? (
        <Checkbox
          name="confirmTimeChange"
          label="Ce rendez-vous est confirmé : je confirme vouloir modifier sa date ou son horaire (pensez à prévenir le pharmacien)."
        />
      ) : null}
      <SubmitButton size="lg">{values.id ? "Enregistrer" : "Créer le rendez-vous"}</SubmitButton>
    </StatefulForm>
  );
}
