import { Pool } from "pg";
import { ExecutionRecord } from "../domain/types";

export type CreateExecution = {
  commands: number;
  result: number;
  duration: number;
};

export type ExecutionsRepo = {
  insert: (data: CreateExecution) => Promise<ExecutionRecord>;
};

export function createExecutionsRepo(pool: Pool): ExecutionsRepo {
  return {
    insert: async (data) => {
      const query = `
        INSERT INTO executions (commands, result, duration)
        VALUES ($1, $2, $3)
        RETURNING id, timestamp, commands, result, duration
      `;

      const res = await pool.query(query, [
        data.commands,
        data.result,
        data.duration,
      ]);

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