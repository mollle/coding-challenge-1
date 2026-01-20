import express, { Express } from "express";
import { registerRoutes } from "./http/routes";
import { createErrorHandler } from "./http/errorHandler";
import { Logger } from "./logging/logger";
import { EnterPathService } from "./application/enterPathService";

export function createApp(deps: {
  logger: Logger;
  enterPathService: EnterPathService;
}): Express {
  const app = express();
  app.use(express.json({ limit: "500kb" }));

  registerRoutes(app, deps.enterPathService);

  app.use(createErrorHandler(deps.logger));
  return app;
}