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

// shorter than this is guessable
function requiredSecret(name: string): string {
  const value = required(name);
  if (value.length < 16) {
    throw new Error(`Environment variable ${name} must be at least 16 characters`);
  }
  return value;
}

// no value --> undefined; a value that is not a date --> fail
function optionalDate(name: string): Date | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Environment variable ${name} must be a date like 2026-11-01T10:00:00Z`);
  }
  return date;
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
    auth: {
      jwtSecret: requiredSecret("JWT_SECRET"),
    },
    sale: {
      startsAt: optionalDate("SALE_STARTS_AT"), // unset = open all the time
    },
    rabbitmq: {
      host: required("RABBITMQ_HOST"),
      port: requiredInt("RABBITMQ_PORT"),
      user: required("RABBITMQ_USER"),
      password: required("RABBITMQ_PASSWORD"),
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
