import { loadEnv } from "./config/env";
import { createLogger } from "./logging/logger";
import { createDb } from "./infrastructure/db";
import { createExecutionsRepo } from "./infrastructure/executionsRepo";
import { createEnterPathService } from "./application/enterPathService";
import { createApp } from "./app";

/**
 * Service entrypoint: loads env, wires dependencies, starts HTTP server.
 * Handles SIGINT/SIGTERM for graceful shutdown (closes HTTP server, then DB pool).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  const db = await createDb(env, logger);
  const repo = createExecutionsRepo(db.pool);
  const enterPathService = createEnterPathService(repo);

  const app = createApp({ logger, enterPathService });

  const server = app.listen(env.port, "0.0.0.0", () => {
    logger.info({ msg: "server listening", port: env.port });
  });

  const closeHttpServer = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      let closeError: unknown | undefined;
      const onError = (err: unknown) => {
        closeError = err;
      };

      server.once("error", onError);

      try {
        server.close(() => {
          server.off("error", onError);
          if (closeError !== undefined) {
            logger.error({ msg: "http server close error", err: closeError });
          }
          resolve();
        });
      } catch (err) {
        server.off("error", onError);
        logger.error({ msg: "http server close error", err });
        resolve();
      }
    });
  };

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ msg: "shutdown requested" });

    await closeHttpServer();
    logger.info({ msg: "http server closed" });

    try {
      await db.close();
    } catch (err) {
      logger.error({ msg: "error closing database", err });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((err) => {
  const logger = createLogger({ logLevel: "error" });
  const message = err instanceof Error ? err.message : "Unknown error";
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error({ msg: "failed to start", err: { message, stack } });
  process.exit(1);
});