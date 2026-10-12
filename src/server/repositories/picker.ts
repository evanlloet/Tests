import "server-only";
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { pharmacies, pharmacyMetrics } from "../db/schema";

/** Liste compacte pour le sélecteur de pharmacie. */
export async function pickerOptions(db: DbOrTx, userId: string) {
  return db
    .select({
      id: pharmacies.id,
      name: pharmacies.name,
      city: pharmacies.city,
      postalCode: pharmacies.postalCode,
      category: pharmacyMetrics.category,
    })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(eq(pharmacies.userId, userId))
    .orderBy(asc(pharmacies.name));
}
