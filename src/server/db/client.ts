import "server-only";
import { createDb } from "./create";

const globalForDb = globalThis as unknown as { leaDb?: ReturnType<typeof createDb> };

/** Connexion unique, réutilisée entre les rechargements à chaud en développement. */
export const db = globalForDb.leaDb ?? createDb(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "production") globalForDb.leaDb = db;

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Client ou transaction : les repositories acceptent les deux. */
export type DbOrTx = Db | Tx;
