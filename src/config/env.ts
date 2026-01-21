export type Env = {
  port: number;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
};

const VALID_LOG_LEVELS: Env["logLevel"][] = ["fatal", "error", "warn", "info", "debug", "trace"];

export function loadEnv(): Env {
  const port = Number.parseInt(process.env.PORT ?? "5000", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT: "${process.env.PORT}" is not a number`);
  }

  const dbPort = Number.parseInt(process.env.DB_PORT ?? "5432", 10);
  if (Number.isNaN(dbPort)) {
    throw new Error(`Invalid DB_PORT: "${process.env.DB_PORT}" is not a number`);
  }

  const logLevel = (process.env.LOG_LEVEL ?? "info") as Env["logLevel"];
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: "${process.env.LOG_LEVEL}" must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
  }

  return {
    port,
    db: {
      host: process.env.DB_HOST ?? "localhost",
      port: dbPort,
      name: process.env.DB_NAME ?? "tibber",
      user: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
    },
    logLevel,
  };
}