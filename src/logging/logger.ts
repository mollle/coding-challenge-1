import pino from "pino";
import { Env } from "../config/env";

export type Logger = pino.Logger;

export function createLogger(env: Pick<Env, "logLevel">): Logger {
  return pino({
    level: env.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}