import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { Logger } from "../logging/logger";

const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Creates middleware that logs HTTP requests on response finish.
 *
 * @param logger - Pino logger instance
 * @returns Express middleware function
 */
export function createRequestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.get(REQUEST_ID_HEADER) || crypto.randomUUID();
    const startTime = process.hrtime.bigint();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on("finish", () => {
      const durationMs =
        Math.round(Number(process.hrtime.bigint() - startTime) / 1e4) / 100;

      const logData = {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      };

      if (res.statusCode >= 500) {
        logger.error(logData, "request completed");
      } else if (res.statusCode >= 400) {
        logger.warn(logData, "request completed");
      } else {
        logger.info(logData, "request completed");
      }
    });

    next();
  };
}
