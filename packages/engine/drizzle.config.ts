import { defineConfig } from "drizzle-kit";
import { defaultDatabaseUrl } from "./src/domain/config.ts";

export default defineConfig({
  schema: "./packages/engine/src/adapters/persistence/schema.ts",
  out: "./packages/engine/drizzle",
  dialect: "sqlite",
  dbCredentials: { url: defaultDatabaseUrl() },
});
