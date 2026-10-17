import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Next's server-only guard throws outside the React server runtime
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Integration tests share one database, so run files one at a time
    fileParallelism: false,
    // Local test database created by scripts/mysql-local.sh; never the dev database
    env: {
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_NAME: "tableqr_test",
      DB_USER: "tableqr",
      DB_PASSWORD: "tableqr_local",
      // Guest online bill payment is off in the app for now; the tests still cover it
      GUEST_ONLINE_PAY: "1",
    },
  },
});
