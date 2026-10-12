import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { addDays, isoWeekday, startOfIsoWeek, type DayKey } from "@/domain/time";
import type { DbOrTx } from "../db/client";
import { territories, weeklyPreferences, weeklyPreferenceTemplates, weekTemplateAssignments } from "../db/schema";

export async function listTerritories(db: DbOrTx, userId: string) {
  return db.select().from(territories).where(eq(territories.userId, userId)).orderBy(asc(territories.name));
}

/** Couleur et nom par code de département, pour l'affichage. */
export async function territoryLookup(db: DbOrTx, userId: string) {
  const rows = await listTerritories(db, userId);
  return new Map(rows.filter((t) => t.kind === "department").map((t) => [t.code, { name: t.name, color: t.color }]));
}

export type WeekTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
  /** jour ISO → codes de département */
  days: Record<number, string[]>;
};

export async function listWeekTemplates(db: DbOrTx, userId: string): Promise<WeekTemplate[]> {
  const templates = await db
    .select()
    .from(weeklyPreferenceTemplates)
    .where(eq(weeklyPreferenceTemplates.userId, userId))
    .orderBy(asc(weeklyPreferenceTemplates.createdAt));
  const prefs = await db
    .select({ templateId: weeklyPreferences.templateId, weekday: weeklyPreferences.weekday, code: territories.code })
    .from(weeklyPreferences)
    .innerJoin(territories, eq(territories.id, weeklyPreferences.territoryId))
    .where(eq(weeklyPreferences.userId, userId));
  return templates.map((t) => {
    const days: Record<number, string[]> = {};
    for (const p of prefs.filter((p) => p.templateId === t.id)) (days[p.weekday] ??= []).push(p.code);
    return { id: t.id, name: t.name, isDefault: t.isDefault, days };
  });
}

/** Remplace les secteurs d'un modèle pour un jour donné. */
export async function setTemplateDay(db: DbOrTx, userId: string, templateId: string, weekday: number, territoryIds: string[]) {
  const [tpl] = await db
    .select({ id: weeklyPreferenceTemplates.id })
    .from(weeklyPreferenceTemplates)
    .where(and(eq(weeklyPreferenceTemplates.id, templateId), eq(weeklyPreferenceTemplates.userId, userId)));
  if (!tpl) throw new Error("Modèle introuvable");
  const owned = territoryIds.length
    ? await db.select({ id: territories.id }).from(territories).where(eq(territories.userId, userId))
    : [];
  const allowed = new Set(owned.map((o) => o.id));
  await db.delete(weeklyPreferences).where(and(eq(weeklyPreferences.templateId, templateId), eq(weeklyPreferences.weekday, weekday)));
  const rows = territoryIds.filter((id) => allowed.has(id)).map((territoryId) => ({ userId, templateId, weekday, territoryId }));
  if (rows.length) await db.insert(weeklyPreferences).values(rows);
}

export async function setDefaultTemplate(db: DbOrTx, userId: string, templateId: string) {
  await db.update(weeklyPreferenceTemplates).set({ isDefault: false }).where(eq(weeklyPreferenceTemplates.userId, userId));
  await db
    .update(weeklyPreferenceTemplates)
    .set({ isDefault: true })
    .where(and(eq(weeklyPreferenceTemplates.id, templateId), eq(weeklyPreferenceTemplates.userId, userId)));
}

/** Active un modèle pour une semaine donnée (null = revenir au modèle par défaut). */
export async function assignWeekTemplate(db: DbOrTx, userId: string, weekStart: DayKey, templateId: string | null) {
  await db.delete(weekTemplateAssignments).where(and(eq(weekTemplateAssignments.userId, userId), eq(weekTemplateAssignments.weekStart, weekStart)));
  if (templateId) await db.insert(weekTemplateAssignments).values({ userId, weekStart, templateId });
}

/** Départements privilégiés pour chaque jour de la période [from, to]. */
export async function preferredDepartmentsByDay(db: DbOrTx, userId: string, from: DayKey, to: DayKey) {
  const templates = await listWeekTemplates(db, userId);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const fallback = templates.find((t) => t.isDefault) ?? templates[0];
  const assignments = await db
    .select()
    .from(weekTemplateAssignments)
    .where(
      and(
        eq(weekTemplateAssignments.userId, userId),
        gte(weekTemplateAssignments.weekStart, startOfIsoWeek(from)),
        lte(weekTemplateAssignments.weekStart, to),
      ),
    );
  const byWeek = new Map(assignments.map((a) => [a.weekStart, a.templateId]));
  const out = new Map<DayKey, { departments: string[]; templateName: string | null }>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const tpl = byId.get(byWeek.get(startOfIsoWeek(day)) ?? "") ?? fallback;
    out.set(day, { departments: tpl?.days[isoWeekday(day)] ?? [], templateName: tpl?.name ?? null });
  }
  return out;
}

export async function activeTemplateForWeek(db: DbOrTx, userId: string, weekStart: DayKey) {
  const templates = await listWeekTemplates(db, userId);
  const [assignment] = await db
    .select()
    .from(weekTemplateAssignments)
    .where(and(eq(weekTemplateAssignments.userId, userId), eq(weekTemplateAssignments.weekStart, weekStart)));
  const active = templates.find((t) => t.id === assignment?.templateId) ?? templates.find((t) => t.isDefault) ?? templates[0] ?? null;
  return { templates, active, isOverride: Boolean(assignment) };
}
