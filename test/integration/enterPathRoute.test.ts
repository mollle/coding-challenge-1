import request from "supertest";
import { createLogger } from "../../src/logging/logger";
import { createApp } from "../../src/app";
import { EnterPathService } from "../../src/application/enterPathService";
import { DatabaseError } from "../../src/http/errorHandler";

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

  it.each([
    {
      name: "body is not an object",
      body: "123",
    },
    {
      name: "start is not an object",
      body: { start: 1, commands: [] },
    },
    {
      name: "start.x is not a number",
      body: { start: { x: "10", y: 22 }, commands: [] },
    },
    {
      name: "start.x is not an integer",
      body: { start: { x: 10.5, y: 22 }, commands: [] },
    },
    {
      name: "start.y is not an integer",
      body: { start: { x: 10, y: 22.5 }, commands: [] },
    },
    {
      name: "commands element is not an object",
      body: { start: { x: 0, y: 0 }, commands: [null] },
    },
    {
      name: "command.direction is invalid",
      body: {
        start: { x: 0, y: 0 },
        commands: [{ direction: "northeast", steps: 1 }],
      },
    },
    {
      name: "command.steps is not a number",
      body: {
        start: { x: 0, y: 0 },
        commands: [{ direction: "east", steps: "1" }],
      },
    },
    {
      name: "command.steps is not an integer",
      body: {
        start: { x: 0, y: 0 },
        commands: [{ direction: "east", steps: 1.25 }],
      },
    },
  ])("returns 400 when %s", async ({ body }) => {
    const service: EnterPathService = {
      execute: jest.fn(async () => ({
        id: 1,
        timestamp: new Date().toISOString(),
        commands: 0,
        result: 1,
        duration: 0.0001,
      })),
    };

    const app = createTestApp(service);

    const req = request(app).post("/tibber-developer-test/enter-path");
    if (typeof body === "string") {
      req.set("Content-Type", "application/json");
    }

    await req.send(body as any).expect(400);
    expect(service.execute).not.toHaveBeenCalled();
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

  it("returns 503 when database is unreachable", async () => {
    const app = createTestApp({
      execute: async () => {
        throw new DatabaseError("Database unavailable");
      },
    });

    const res = await request(app)
      .post("/tibber-developer-test/enter-path")
      .send({
        start: { x: 10, y: 22 },
        commands: [{ direction: "east", steps: 1 }],
      })
      .expect(503);

    expect(res.body).toEqual({ error: "Service Unavailable" });
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