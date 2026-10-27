import { fileURLToPath } from 'node:url';

// Load app/.env into process.env (variables that are already set are not overwritten)
process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
