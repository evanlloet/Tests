/**
 * Installation locale en une commande (Mac, Windows, Linux) : `npm run setup`.
 *
 * 1. crée le fichier .env à partir de .env.example (en demandant l'utilisateur et le
 *    mot de passe PostgreSQL) s'il n'existe pas encore ;
 * 2. crée la base de données si elle n'existe pas ;
 * 3. applique les migrations (création des tables).
 *
 * Options (facultatives) : --user, --password, --host, --port, --database, --env <fichier>
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : null))
    .filter(Boolean),
);
const envFile = args.env || ".env";

/** Questions au terminal (fonctionne aussi avec une entrée redirigée). */
function prompter() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question, fallback) {
      process.stdout.write(`${question}${fallback !== undefined ? ` [${fallback || "aucun"}]` : ""} : `);
      const { value, done } = await lines.next();
      const answer = done ? "" : String(value).trim();
      return answer || fallback || "";
    },
    close: () => rl.close(),
  };
}

function readDatabaseUrl(file) {
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

async function main() {
  console.log("\nInstallation de Léa\n");
  let url;
  if (existsSync(envFile)) {
    url = readDatabaseUrl(envFile);
    console.log(`Fichier ${envFile} déjà présent : base ${url ? new URL(url).pathname.slice(1) : "?"}.`);
  } else {
    const interactive = !(args.user !== undefined && args.password !== undefined);
    const rl = interactive ? prompter() : null;
    // Postgres.app (Mac) : votre nom de session, sans mot de passe. Installeur Windows : « postgres » + le mot de passe choisi.
    const defaultUser = process.platform === "darwin" ? userInfo().username : "postgres";
    const user = args.user ?? (await rl.ask("Utilisateur PostgreSQL", defaultUser));
    const password = args.password ?? (await rl.ask("Mot de passe PostgreSQL (Entrée s'il n'y en a pas)", ""));
    rl?.close();
    const host = args.host || "localhost";
    const port = args.port || "5432";
    const database = args.database || "lea";
    const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
    url = `postgres://${auth}@${host}:${port}/${database}`;
    copyFileSync(".env.example", envFile);
    const content = readFileSync(envFile, "utf8").replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`);
    writeFileSync(envFile, content);
    console.log(`✓ Fichier ${envFile} créé.`);
  }
  if (!url) throw new Error(`DATABASE_URL absent de ${envFile}.`);

  const target = new URL(url);
  const database = decodeURIComponent(target.pathname.slice(1));
  if (["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
    const admin = new URL(url);
    admin.pathname = "/postgres";
    const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
    try {
      const [exists] = await sql`select 1 from pg_database where datname = ${database}`;
      if (exists) console.log(`✓ Base « ${database} » déjà créée.`);
      else {
        await sql.unsafe(`create database "${database.replace(/"/g, '""')}"`);
        console.log(`✓ Base « ${database} » créée.`);
      }
    } finally {
      await sql.end();
    }
  }

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("✓ Tables prêtes.");
  } finally {
    await client.end();
  }
  console.log("\nTout est prêt. Lancez « npm run dev » puis ouvrez http://localhost:3000 dans votre navigateur.\n");
}

main().catch((err) => {
  const msg = String(err?.message ?? err);
  console.error(`\n✗ ${msg}`);
  if (/ECONNREFUSED|connect/i.test(msg)) console.error("  PostgreSQL ne répond pas : vérifiez qu'il est installé et démarré (Postgres.app ouvert sur Mac).");
  if (/password|authentication/i.test(msg)) console.error(`  Utilisateur ou mot de passe refusé : supprimez le fichier ${envFile} et relancez « npm run setup ».`);
  process.exit(1);
});
