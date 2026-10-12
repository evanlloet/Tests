"use client";

import { proposeSlotAction } from "@/server/actions/appointments";
import { ActionForm, SubmitButton } from "./action-form";

export function ProposeSlotButton({ pharmacyId, title, day, start, end, label = "Ajouter au planning" }: { pharmacyId: string; title: string; day: string; start: string; end: string; label?: string }) {
  return (
    <ActionForm action={proposeSlotAction}>
      <input type="hidden" name="pharmacyId" value={pharmacyId} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <SubmitButton size="sm" pendingLabel="Ajout…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
