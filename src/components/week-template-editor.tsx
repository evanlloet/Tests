"use client";

import { setDefaultTemplateAction, setTemplateDayAction } from "@/server/actions/profile";
import { ActionForm, SubmitButton } from "./action-form";
import { Badge } from "./ui/badge";

const DAYS = [
  [1, "Lundi"],
  [2, "Mardi"],
  [3, "Mercredi"],
  [4, "Jeudi"],
  [5, "Vendredi"],
] as const;

export function WeekTemplateEditor({
  template,
  territories,
}: {
  template: { id: string; name: string; isDefault: boolean; days: Record<number, string[]> };
  territories: { id: string; code: string; name: string; color: string }[];
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{template.name}</h3>
        {template.isDefault ? (
          <Badge tone="primary">Modèle par défaut</Badge>
        ) : (
          <ActionForm action={setDefaultTemplateAction} feedback={false}>
            <input type="hidden" name="templateId" value={template.id} />
            <SubmitButton size="sm" variant="ghost" className="border border-border" pendingLabel="…">
              Utiliser par défaut
            </SubmitButton>
          </ActionForm>
        )}
      </div>
      <ul className="space-y-2">
        {DAYS.map(([weekday, label]) => (
          <li key={weekday}>
            <ActionForm action={setTemplateDayAction} className="flex flex-wrap items-center gap-2" feedback={false}>
              <input type="hidden" name="templateId" value={template.id} />
              <input type="hidden" name="weekday" value={weekday} />
              <span className="w-20 text-sm font-medium">{label}</span>
              {territories.map((t) => (
                <label
                  key={t.id}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-2 border-border px-2 py-0.5 text-xs text-muted has-checked:border-(--c) has-checked:bg-surface-2 has-checked:font-semibold has-checked:text-text has-focus-visible:outline-2 has-focus-visible:outline-primary"
                  style={{ ["--c" as string]: t.color }}
                >
                  <input type="checkbox" name="territoryIds" value={t.id} defaultChecked={template.days[weekday]?.includes(t.code)} className="sr-only" />
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
                  {t.name}
                </label>
              ))}
              <SubmitButton size="sm" variant="ghost" className="ml-auto text-xs" pendingLabel="…">
                Enregistrer
              </SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}
