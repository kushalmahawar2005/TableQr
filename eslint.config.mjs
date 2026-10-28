import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-load/**",
    "out/**",
    "output/**",
    "tmp/**",
    "build/**",
    "next-env.d.ts",
    // Cloudflare Worker, checked by its own tsconfig
    "realtime/**",
    // Android rider app (Capacitor), built on its own
    "rider-app/**",
  ]),
]);

export default eslintConfig;
