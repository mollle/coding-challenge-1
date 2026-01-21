import { Pool } from "pg";
import { ExecutionRecord } from "../domain/types";
import { DatabaseError } from "../http/errorHandler";

export type CreateExecution = {
  /** Number of command elements processed (commands.length). */
  commands: number;
  /** Number of unique vertices cleaned. */
  result: number;
  /** Domain computation duration in seconds (fractional). */
  duration: number;
};

export type ExecutionsRepo = {
  /** Inserts an execution row and returns the created record. */
  insert: (data: CreateExecution) => Promise<ExecutionRecord>;
};

/**
 * Creates a repository for the `executions` table.
 *
 * Handles INSERT operations and maps PostgreSQL types to domain types.
 * Throws DatabaseError on connection issues (ECONNREFUSED, timeouts, etc.).
 *
 * @param pool - pg Pool instance for database access
 * @returns Repository with insert method
 */
export function createExecutionsRepo(pool: Pool): ExecutionsRepo {
  return {
    insert: async (data) => {
      const query = `
        INSERT INTO executions (commands, result, duration)
        VALUES ($1, $2, $3)
        RETURNING id, timestamp, commands, result, duration
      `;

      let res;
      try {
        res = await pool.query(query, [
          data.commands,
          data.result,
          data.duration,
        ]);
      } catch (err) {
        const pgError = err as { code?: string; message?: string };
        // Connection refused, pool exhausted, or connection timeout
        if (
          pgError.code === "ECONNREFUSED" ||
          pgError.code === "57P01" || // admin_shutdown
          pgError.code === "57P02" || // crash_shutdown
          pgError.code === "57P03" || // cannot_connect_now
          pgError.message?.includes("timeout") ||
          pgError.message?.includes("Connection terminated")
        ) {
          throw new DatabaseError("Database unavailable");
        }
        throw err;
      }

      const row = res.rows[0] as {
        id: string | number;
        timestamp: string;
        commands: number;
        result: string | number;
        duration: string | number;
      };

      return {
        id: Number(row.id),
        timestamp: row.timestamp,
        commands: row.commands,
        result: Number(row.result),
        duration: Number(row.duration),
      };
    },
  };
}