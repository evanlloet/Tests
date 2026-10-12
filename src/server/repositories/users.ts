import "server-only";
import { eq, sql } from "drizzle-orm";
import { DEPARTMENTS, INITIAL_TERRITORIES } from "@/domain/departments";
import type { DbOrTx } from "../db/client";
import { territories, travelPreferences, users, weeklyPreferences, weeklyPreferenceTemplates } from "../db/schema";

export async function findUserByEmail(db: DbOrTx, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return user ?? null;
}

/** Modèles de semaine du brief : principal et variante. */
export const DEFAULT_WEEK_TEMPLATES: { name: string; isDefault: boolean; days: Record<number, string[]> }[] = [
  { name: "Semaine type", isDefault: true, days: { 1: ["14"], 2: ["14"], 3: ["50"], 4: ["50"], 5: ["35"] } },
  { name: "Variante Orne / Mayenne", isDefault: false, days: { 1: ["61"], 2: ["61"], 3: ["50"], 4: ["53"], 5: ["35"] } },
];

/**
 * Crée un compte avec la configuration initiale : territoire (5 départements),
 * modèles de semaine, préférences de déplacement. À exécuter dans une transaction.
 */
export async function createUserWithDefaults(
  tx: DbOrTx,
  input: { email: string; passwordHash: string; displayName: string },
): Promise<string> {
  const [user] = await tx
    .insert(users)
    .values({ email: input.email.trim(), passwordHash: input.passwordHash, displayName: input.displayName.trim() })
    .returning({ id: users.id });
  const userId = user!.id;

  await tx.insert(travelPreferences).values({ userId, homeLabel: "Domicile (Rennes)" });

  const insertedTerritories = await tx
    .insert(territories)
    .values(
      INITIAL_TERRITORIES.map((t) => ({
        userId,
        kind: "department" as const,
        code: t.code,
        name: DEPARTMENTS[t.code]!,
        color: t.color,
      })),
    )
    .returning({ id: territories.id, code: territories.code });
  const territoryByCode = new Map(insertedTerritories.map((t) => [t.code, t.id]));

  for (const template of DEFAULT_WEEK_TEMPLATES) {
    const [tpl] = await tx
      .insert(weeklyPreferenceTemplates)
      .values({ userId, name: template.name, isDefault: template.isDefault })
      .returning({ id: weeklyPreferenceTemplates.id });
    const rows = Object.entries(template.days).flatMap(([weekday, codes]) =>
      codes.map((code) => ({ userId, templateId: tpl!.id, weekday: Number(weekday), territoryId: territoryByCode.get(code)! })),
    );
    await tx.insert(weeklyPreferences).values(rows);
  }
  return userId;
}

export async function getUserSettings(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({ user: users, travel: travelPreferences })
    .from(users)
    .leftJoin(travelPreferences, eq(travelPreferences.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new Error("Utilisateur introuvable");
  return row;
}
