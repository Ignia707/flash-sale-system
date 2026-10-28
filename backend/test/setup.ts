import { fileURLToPath } from "node:url";

// Load app/.env into process.env
process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
