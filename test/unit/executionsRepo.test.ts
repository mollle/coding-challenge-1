import { Pool } from "pg";
import { createExecutionsRepo } from "../../src/infrastructure/executionsRepo";

describe("ExecutionsRepo", () => {
  it("inserts execution and maps returned row to ExecutionRecord", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: "1",
          timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
          commands: 2,
          result: "4",
          duration: "0.0001",
        },
      ],
    });

    const pool = { query } as unknown as Pool;
    const repo = createExecutionsRepo(pool);

    const record = await repo.insert({ commands: 2, result: 4, duration: 0.0001 });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO executions"),
      [2, 4, 0.0001]
    );

    expect(record).toEqual({
      id: 1,
      timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      commands: 2,
      result: 4,
      duration: 0.0001,
    });
  });
});
