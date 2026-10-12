import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Crée un client Drizzle. Utilisé par l'application, les scripts et les tests. */
export function createDb(url: string | undefined) {
  if (!url) {
    throw new Error("DATABASE_URL n'est pas défini. Copiez .env.example vers .env et renseignez la base PostgreSQL.");
  }
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    // Les poolers de type PgBouncer en mode transaction (Supabase 6543) ne gèrent pas les requêtes préparées.
    prepare: !/pooler\.supabase\.com:6543/.test(url),
    onnotice: () => {},
  });
  return drizzle(client, { schema, casing: "snake_case" });
}
