import request from "supertest";
import { createLogger } from "../../src/logging/logger";
import { createApp } from "../../src/app";
import { EnterPathService } from "../../src/application/enterPathService";
import { ExecutionRecord } from "../../src/domain/types";

function createTestApp(fakeService?: EnterPathService) {
  const logger = createLogger({ logLevel: "fatal" });
  const service: EnterPathService = fakeService ?? {
    execute: async () => ({
      id: 1,
      timestamp: new Date().toISOString(),
      commands: 2,
      result: 4,
      duration: 0.0001,
    }),
  };
  return createApp({ logger, enterPathService: service });
}

describe("POST /tibber-developer-test/enter-path", () => {
  it("returns 201 and the execution record shape", async () => {
    const app = createTestApp();

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

  it("returns 400 for invalid JSON", async () => {
    const app = createTestApp();

    const res = await request(app)
      .post("/tibber-developer-test/enter-path")
      .set("Content-Type", "application/json")
      .send("{ invalid json }")
      .expect(400);

    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when start is missing", async () => {
    const app = createTestApp();

    const res = await request(app)
      .post("/tibber-developer-test/enter-path")
      .send({ commands: [] })
      .expect(400);

    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when commands is missing", async () => {
    const app = createTestApp();

    const res = await request(app)
      .post("/tibber-developer-test/enter-path")
      .send({ start: { x: 0, y: 0 } })
      .expect(400);

    expect(res.body).toHaveProperty("error");
  });

  it("returns 500 when service throws an unexpected error", async () => {
    const app = createTestApp({
      execute: async () => {
        throw new Error("error");
      },
    });

    const res = await request(app)
      .post("/tibber-developer-test/enter-path")
      .send({
        start: { x: 10, y: 22 },
        commands: [{ direction: "east", steps: 1 }],
      })
      .expect(500);

    expect(res.body).toEqual({ error: "Internal Server Error" });
  });
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = createTestApp();

    const res = await request(app).get("/health").expect(200);

    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("Unknown routes", () => {
  it("returns 404 for unknown paths", async () => {
    const app = createTestApp();

    const res = await request(app).get("/unknown").expect(404);

    expect(res.body).toEqual({ error: "Not Found" });
  });
});