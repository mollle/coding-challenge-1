import { Express, NextFunction, Request, Response } from "express";
import { EnterPathService } from "../application/enterPathService";
import { Command, Direction, EnterPathRequestBody, Start } from "../domain/types";
import { ValidationError } from "./errorHandler";

const VALID_DIRECTIONS: Direction[] = ["north", "east", "south", "west"];

function isStart(value: unknown): value is Start {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof (value as Start).x === "number" &&
    typeof (value as Start).y === "number"
  );
}

function isCommand(value: unknown): value is Command {
  return (
    typeof value === "object" &&
    value !== null &&
    "direction" in value &&
    "steps" in value &&
    typeof (value as Command).direction === "string" &&
    VALID_DIRECTIONS.includes((value as Command).direction as Direction) &&
    typeof (value as Command).steps === "number"
  );
}

function validateRequestBody(body: unknown): EnterPathRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be an object");
  }

  const obj = body as Record<string, unknown>;

  if (!("start" in obj) || !isStart(obj.start)) {
    throw new ValidationError("Invalid or missing 'start' (expected {x: number, y: number})");
  }

  if (!("commands" in obj) || !Array.isArray(obj.commands)) {
    throw new ValidationError("Invalid or missing 'commands' (expected array)");
  }

  for (let i = 0; i < obj.commands.length; i++) {
    if (!isCommand(obj.commands[i])) {
      throw new ValidationError(
        `Invalid command at index ${i} (expected {direction: north|east|south|west, steps: number})`
      );
    }
  }

  return { start: obj.start as Start, commands: obj.commands as Command[] };
}

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