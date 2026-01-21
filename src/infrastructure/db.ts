import { Pool } from "pg";
import { Env } from "../config/env";
import { Logger } from "../logging/logger";

/**
 * Database connection wrapper.
 * @property pool - pg Pool instance for query execution
 * @property close - Gracefully closes all pool connections
 */
export type Db = {
  pool: Pool;
  close: () => Promise<void>;
};

/**
 * Creates and verifies a PostgreSQL connection pool.
 * @param env - Environment configuration with database settings
 * @param logger - Logger for connection status messages
 * @returns Database wrapper with pool and close method
 * @throws If initial connection test fails
 */
export async function createDb(env: Env, logger: Logger): Promise<Db> {
  const pool = new Pool({
    host: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    try {
      await pool.end();
    } catch (closeErr) {
      logger.error({
        err: closeErr,
        msg: "failed to close database pool after connection test failure",
      });
    }

    logger.error({
      err,
      msg: "database connection test failed",
      context: "createDb",
    });

    throw err;
  }
  logger.info({ msg: "database connected" });

  return {
    pool,
    close: async () => {
      await pool.end();
      logger.info({ msg: "database connection closed" });
    },
  };
}