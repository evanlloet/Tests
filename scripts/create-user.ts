/**
 * Crée un compte en ligne de commande (utile quand ALLOW_SIGNUP=false).
 * Usage : npm run user:create -- <email> <prénom>
 * Le mot de passe est demandé de façon interactive (non affiché, non stocké dans l'historique).
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { createDb } from "../src/server/db/create";
import { hashPassword, passwordPolicyError } from "../src/server/auth/password";
import { createUserWithDefaults, findUserByEmail } from "../src/server/repositories/users";

async function main() {
  const [email, displayName] = process.argv.slice(2);
  if (!email || !displayName) {
    console.error("Usage : npm run user:create -- <email> <prénom>");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = process.env.LEA_PASSWORD ?? (await rl.question("Mot de passe : "));
  rl.close();
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  const db = createDb(process.env.DATABASE_URL);
  if (await findUserByEmail(db, email)) throw new Error("Un compte existe déjà avec cette adresse.");
  const passwordHash = await hashPassword(password);
  const id = await db.transaction((tx) => createUserWithDefaults(tx, { email, passwordHash, displayName }));
  await db.$client.end();
  console.log(`Compte créé (${id}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
