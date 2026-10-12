import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Interface en français : les apostrophes sont omniprésentes et sans risque en JSX.
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", "public/vendor/**", "next-env.d.ts"],
  },
];

export default config;
