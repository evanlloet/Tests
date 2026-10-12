import type { Appointment } from "@/server/db/schema";

export const APPOINTMENT_STATUS: Record<Appointment["status"], { label: string; tone: "success" | "info" | "warning" | "neutral" }> = {
  confirmed: { label: "Confirmé", tone: "success" },
  pending: { label: "En attente", tone: "warning" },
  proposed: { label: "Proposé", tone: "info" },
  cancelled: { label: "Annulé", tone: "neutral" },
};

export const OUTCOME: Record<Appointment["outcome"], { label: string; tone: "success" | "neutral" | "danger" }> = {
  unknown: { label: "Réalisation non confirmée", tone: "neutral" },
  done: { label: "Réalisée", tone: "success" },
  missed: { label: "Non réalisée", tone: "danger" },
};

export const SOURCE_LABEL: Record<Appointment["source"], string> = {
  manual: "Saisie manuelle",
  calendar_import: "Import Outlook",
  suggestion: "Proposition de Léa",
  route_plan: "Scénario de tournée",
};

export const DUE_TONE = {
  overdue: "danger",
  never_visited: "warning",
  due_soon: "warning",
  planned: "info",
  ok: "success",
  unknown: "neutral",
} as const;

export function formatKm(km: number) {
  return `${Math.round(km).toLocaleString("fr-FR")} km`;
}

export function formatEuros(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}
