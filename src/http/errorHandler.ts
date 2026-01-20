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

export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void {
    // JSON parse error from express.json()
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Bad Request: Invalid JSON" });
      return;
    }

    // Validation error (type mismatch)
    if (err instanceof ValidationError) {
      res.status(400).json({ error: `Bad Request: ${err.message}` });
      return;
    }

    // All other errors -> 500
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error({ msg: "request failed", err: { message, stack } });

    res.status(500).json({ error: "Internal Server Error" });
  };
}