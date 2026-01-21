import pino from "pino";
import { Env } from "../config/env";

/** Pino logger instance type. */
export type Logger = pino.Logger;

/**
 * Creates a structured JSON logger.
 * @param env - Environment config with logLevel ('debug', 'info', 'warn', 'error')
 * @returns Configured pino logger instance
 */
export function createLogger(env: Pick<Env, "logLevel">): Logger {
  return pino({
    level: env.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}