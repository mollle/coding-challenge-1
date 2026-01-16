import { countUniqueCleaned } from "../domain/robotPath";
import { EnterPathRequestBody, ExecutionRecord } from "../domain/types";
import { ExecutionsRepo } from "../infrastructure/executionsRepo";

export type EnterPathService = {
  execute: (body: EnterPathRequestBody) => Promise<ExecutionRecord>;
};

export function createEnterPathService(repo: ExecutionsRepo): EnterPathService {
  return {
    execute: async (body) => {
      const startNs = process.hrtime.bigint();
      const result = countUniqueCleaned(body.start, body.commands);
      const endNs = process.hrtime.bigint();

      const durationSeconds = Number(endNs - startNs) / 1e9;

      return repo.insert({
        commands: body.commands.length,
        result,
        duration: durationSeconds,
      });
    },
  };
}