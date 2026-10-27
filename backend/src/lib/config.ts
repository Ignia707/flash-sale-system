// load settings from environment vars - fail immediately if one is missing

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredInt(name: string): number {
  const value = Number(required(name));
  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return value;
}

export function loadConfig() {
  return {
    api: {
      port: requiredInt("API_PORT"),
    },
    postgres: {
      host: required("POSTGRES_HOST"),
      port: requiredInt("POSTGRES_PORT"),
      user: required("POSTGRES_USER"),
      password: required("POSTGRES_PASSWORD"),
      database: required("POSTGRES_DB"),
    },
    redis: {
      host: required("REDIS_HOST"),
      port: requiredInt("REDIS_PORT"),
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
