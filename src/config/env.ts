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

export function loadEnv(): Env {
  const port = Number.parseInt(process.env.PORT ?? "5000", 10);

  return {
    port,
    db: {
      host: process.env.DB_HOST ?? "localhost",
      port: Number.parseInt(process.env.DB_PORT ?? "5432", 10),
      name: process.env.DB_NAME ?? "tibber",
      user: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
    },
    logLevel: (process.env.LOG_LEVEL ?? "info") as Env["logLevel"],
  };
}