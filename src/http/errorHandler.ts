import { NextFunction, Request, Response } from "express";
import { Logger } from "../logging/logger";

/**
 * Custom error for validation failures (returns 400).
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Custom error for database connectivity issues (returns 503).
 */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Creates Express error-handling middleware.
 * Handles ValidationError (400), DatabaseError (503), and unknown errors (500).
 * @param logger - Logger instance for error reporting
 * @returns Express error handler middleware
 */
export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;

    // JSON parse error from express.json()
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Bad Request: Invalid JSON" });
      return;
    }

    // Payload too large from express.json({ limit })
    if (
      isRecord(err) &&
      (err["type"] === "entity.too.large" ||
        err["name"] === "PayloadTooLargeError" ||
        err["status"] === 413)
    ) {
      res.status(413).json({ error: "Payload Too Large" });
      return;
    }

    // Validation error (type mismatch)
    if (err instanceof ValidationError) {
      res.status(400).json({ error: `Bad Request: ${err.message}` });
      return;
    }

    // Database connectivity error -> 503
    if (err instanceof DatabaseError) {
      logger.error({ msg: "database unavailable", err: err.message });
      res.status(503).json({ error: "Service Unavailable" });
      return;
    }

    // All other errors -> 500
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error({ msg: "request failed", err: { message, stack } });

    res.status(500).json({ error: "Internal Server Error" });
  };
}