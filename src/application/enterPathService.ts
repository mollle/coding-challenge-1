import { countUniqueCleaned } from "../domain/robotPath";
import { EnterPathRequestBody, ExecutionRecord } from "../domain/types";
import { ExecutionsRepo } from "../infrastructure/executionsRepo";

export type EnterPathService = {
  /**
   * Executes a full "enter-path" request.
   *
   * - Computes the path result using pure domain logic.
   * - Measures computation duration in seconds (fractional) using a monotonic clock.
   * - Persists the result and returns the created execution record.
   */
  execute: (body: EnterPathRequestBody) => Promise<ExecutionRecord>;
};

/**
 * Creates the application-layer service orchestrating timing + domain logic + persistence.
 */
export function createEnterPathService(repo: ExecutionsRepo): EnterPathService {
  return {
    execute: async (body) => {
      const startNs = process.hrtime.bigint();
      const result = countUniqueCleaned(body.start, body.commands);
      const endNs = process.hrtime.bigint();

      const durationSeconds = Number(endNs - startNs) / 1e9;
      const durationRounded = parseFloat(durationSeconds.toFixed(6));

      return repo.insert({
        commands: body.commands.length,
        result,
        duration: durationRounded,
      });
    },
  };
}