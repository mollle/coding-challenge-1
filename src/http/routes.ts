import { Express, NextFunction, Request, Response } from "express";
import { EnterPathService } from "../application/enterPathService";
import { EnterPathRequestBody } from "../domain/types";
import { ValidationError } from "./errorHandler";

/**
 * Minimal guard: checks that start and commands exist.
 * Per task spec, inputs are assumed well-formed, so no elaborate validation.
 */
function validateRequestBody(body: unknown): EnterPathRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be an object");
  }

  const obj = body as Record<string, unknown>;

  if (!("start" in obj)) {
    throw new ValidationError("Missing 'start'");
  }

  if (!("commands" in obj) || !Array.isArray(obj.commands)) {
    throw new ValidationError("Missing or invalid 'commands'");
  }

  return obj as unknown as EnterPathRequestBody;
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