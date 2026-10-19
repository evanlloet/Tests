import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Les tests d'intégration partagent une base PostgreSQL : pas de parallélisme entre fichiers.
    fileParallelism: false,
    env: {
      TZ: "UTC",
      // Les services utilisent le client partagé : il pointe sur la base de test.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://lea:lea@localhost:5432/lea_test",
      OSRM_URL: "",
      // Pas d'appel réseau pendant les tests : estimation à vol d'oiseau
      ROUTING_PROVIDER: "estimate",
    },
  },
});
