import { loadEnv } from "./config/env";
import { createLogger } from "./logging/logger";
import { createDb } from "./infrastructure/db";
import { createExecutionsRepo } from "./infrastructure/executionsRepo";
import { createEnterPathService } from "./application/enterPathService";
import { createApp } from "./app";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  const db = await createDb(env, logger);
  const repo = createExecutionsRepo(db.pool);
  const enterPathService = createEnterPathService(repo);

  const app = createApp({ logger, enterPathService });

  app.listen(env.port, "0.0.0.0", () => {
    logger.info({ msg: "server listening", port: env.port });
  });

  const shutdown = async () => {
    logger.info({ msg: "shutdown requested" });
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  const logger = createLogger({ logLevel: "error" });
  const message = err instanceof Error ? err.message : "Unknown error";
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error({ msg: "failed to start", err: { message, stack } });
  process.exit(1);
});