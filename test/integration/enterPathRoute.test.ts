import request from "supertest";
import { createLogger } from "../../src/logging/logger";
import { createApp } from "../../src/app";
import { EnterPathService } from "../../src/application/enterPathService";
import { ExecutionRecord } from "../../src/domain/types";

describe("POST /tibber-developer-test/enter-path", () => {
  it("returns 201 and the execution record shape", async () => {
    const logger = createLogger({ logLevel: "fatal" });

    const fakeService: EnterPathService = {
      execute: async () => {
        const rec: ExecutionRecord = {
          id: 1,
          timestamp: new Date().toISOString(),
          commands: 2,
          result: 4,
          duration: 0.0001,
        };
        return rec;
      },
    };

    const app = createApp({ logger, enterPathService: fakeService });

    const res = await request(app)
      .post("/tibber-developer-test/enter-path")
      .send({
        start: { x: 10, y: 22 },
        commands: [
          { direction: "east", steps: 2 },
          { direction: "north", steps: 1 },
        ],
      })
      .expect(201);

    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("commands");
    expect(res.body).toHaveProperty("result");
    expect(res.body).toHaveProperty("duration");
  });
});