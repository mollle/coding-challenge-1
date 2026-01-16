import { NextFunction, Request, Response } from "express";
import { Logger } from "../logging/logger";

export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error({ msg: "request failed", err: { message, stack } });

    res.status(500).json({ error: "Internal Server Error" });
  };
}