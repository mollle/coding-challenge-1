import express, { Express } from "express";
import { registerRoutes } from "./http/routes";
import { createErrorHandler } from "./http/errorHandler";
import { createRequestLogger } from "./http/requestLogger";
import { Logger } from "./logging/logger";
import { EnterPathService } from "./application/enterPathService";

/**
 * Creates and configures the Express application.
 *
 * Wires together:
 * - JSON body parsing (1MB limit)
 * - Route registration
 * - Centralized error handling
 *
 * @param deps - Injected dependencies (logger, enterPathService)
 * @returns Configured Express application (not yet listening)
 */
export function createApp(deps: {
  logger: Logger;
  enterPathService: EnterPathService;
}): Express {
  const app = express();

  app.use(createRequestLogger(deps.logger));
  app.use(express.json({ limit: "1mb" }));

  registerRoutes(app, deps.enterPathService);

  app.use(createErrorHandler(deps.logger));
  return app;
}