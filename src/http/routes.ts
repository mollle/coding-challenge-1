import { Express, NextFunction, Request, Response } from "express";
import { EnterPathService } from "../application/enterPathService";
import { EnterPathRequestBody } from "../domain/types";
import { ValidationError } from "./errorHandler";

/**
 * Minimal guard: checks basic shape + primitive types.
 */
function validateRequestBody(body: unknown): EnterPathRequestBody {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  const isFiniteInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);

  const isDirection = (value: unknown): value is EnterPathRequestBody["commands"][number]["direction"] =>
    value === "north" || value === "east" || value === "south" || value === "west";

  if (!isRecord(body)) {
    throw new ValidationError("Request body must be an object");
  }

  if (!("start" in body)) {
    throw new ValidationError("Missing 'start'");
  }
  if (!("commands" in body) || !Array.isArray(body.commands)) {
    throw new ValidationError("Missing or invalid 'commands'");
  }

  const start = body.start;
  if (!isRecord(start)) {
    throw new ValidationError("Invalid 'start'");
  }
  if (!isFiniteInteger(start.x) || !isFiniteInteger(start.y)) {
    throw new ValidationError("Invalid 'start' coordinates");
  }

  for (const cmd of body.commands) {
    if (!isRecord(cmd)) {
      throw new ValidationError("Invalid command");
    }

    if (!isDirection(cmd.direction)) {
      throw new ValidationError("Invalid command direction");
    }

    if (!isFiniteInteger(cmd.steps)) {
      throw new ValidationError("Invalid command steps");
    }
  }

  return body as EnterPathRequestBody;
}

/**
 * Registers all HTTP routes on the Express app.
 *
 * Routes:
 * - GET /health - Liveness check
 * - POST /tibber-developer-test/enter-path - Execute robot path and persist result
 *
 * @param app - Express application instance
 * @param service - EnterPathService for handling path execution
 */
export function registerRoutes(app: Express, service: EnterPathService): void {
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(
    "/tibber-developer-test/enter-path",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = validateRequestBody(req.body);
        const execution = await service.execute(body);
        res.status(201).json(execution);
      } catch (err) {
        next(err);
      }
    }
  );

  // 404 for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not Found" });
  });
}