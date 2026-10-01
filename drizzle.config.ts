import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { dbConfig } from "./src/db/config";

loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: dbConfig(),
  strict: true,
  verbose: true,
});
