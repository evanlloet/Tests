import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/server/db/create";

async function main() {
  const db = createDb(process.env.DATABASE_URL);
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.$client.end();
  console.log("Migrations appliquées.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
