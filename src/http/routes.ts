import { Express, Request, Response } from "express";
import { EnterPathService } from "../application/enterPathService";
import { EnterPathRequestBody } from "../domain/types";

export function registerRoutes(app: Express, service: EnterPathService): void {
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(
    "/tibber-developer-test/enter-path",
    async (req: Request, res: Response) => {
      const body = req.body as EnterPathRequestBody;
      const execution = await service.execute(body);
      res.status(201).json(execution);
    }
  );
}