import { createEnterPathService } from "../../src/application/enterPathService";
import { EnterPathRequestBody, ExecutionRecord } from "../../src/domain/types";
import { ExecutionsRepo } from "../../src/infrastructure/executionsRepo";

describe("EnterPathService", () => {
  it("persists commands count, result and duration; returns created record", async () => {
    const repo: ExecutionsRepo = {
      insert: async (data) => {
        const record: ExecutionRecord = {
          id: 123,
          timestamp: new Date().toISOString(),
          commands: data.commands,
          result: data.result,
          duration: data.duration,
        };
        return record;
      },
    };

    const service = createEnterPathService(repo);

    const body: EnterPathRequestBody = {
      start: { x: 10, y: 22 },
      commands: [
        { direction: "east", steps: 2 },
        { direction: "north", steps: 1 },
      ],
    };

    const record = await service.execute(body);

    expect(record.id).toBe(123);
    expect(record.commands).toBe(2);
    expect(record.result).toBe(4);
    expect(record.duration).toBeGreaterThanOrEqual(0);
    expect(typeof record.timestamp).toBe("string");
  });
});