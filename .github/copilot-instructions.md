# Copilot instructions (coding-challenge-1)

## Task contract (non-negotiable)
- Treat [task.md](task.md) as the authoritative specification. Every requirement and note in it is essential and must be followed exactly.
- Do not implement behavior that contradicts [task.md](task.md). If a request would conflict, stop and ask for clarification/confirmation rather than “improving” the spec.
- Examples of “must follow” from the spec: listen on port `5000`, persist to Postgres with the `executions` shape, count every visited vertex (including start and intermediate steps), and avoid elaborate validation (inputs are assumed well-formed).

## Project shape
- Node.js + TypeScript + Express service exposing a single API for “robot path” executions.
- Architecture is intentionally simple and layered:
  - HTTP layer: route registration + error middleware in [src/http/routes.ts](src/http/routes.ts) and [src/http/errorHandler.ts](src/http/errorHandler.ts)
  - Application layer: orchestration + timing + persistence in [src/application/enterPathService.ts](src/application/enterPathService.ts)
  - Domain layer: pure logic (no IO) in [src/domain/robotPath.ts](src/domain/robotPath.ts) and helpers/types in [src/domain/direction.ts](src/domain/direction.ts) / [src/domain/types.ts](src/domain/types.ts)
  - Infrastructure: Postgres access via `pg` Pool in [src/infrastructure/db.ts](src/infrastructure/db.ts) and insert repo in [src/infrastructure/executionsRepo.ts](src/infrastructure/executionsRepo.ts)

## Data flow (request → DB)
- `POST /tibber-developer-test/enter-path` (see [src/http/routes.ts](src/http/routes.ts)) calls `EnterPathService.execute()`.
- Service computes cleaned vertices via `countUniqueCleaned(start, commands)` (pure) and measures duration using `process.hrtime.bigint()` (see [src/application/enterPathService.ts](src/application/enterPathService.ts)).
- Persistence is done through `ExecutionsRepo.insert({ commands, result, duration })`, returning an `ExecutionRecord` mapped from SQL types (see [src/infrastructure/executionsRepo.ts](src/infrastructure/executionsRepo.ts)).

## Conventions and patterns to follow
- Prefer dependency injection over importing singletons:
  - `createApp({ logger, enterPathService })` wires the HTTP layer (see [src/app.ts](src/app.ts)).
  - `src/index.ts` composes env → logger → db → repo → service → app.
  - For new features, follow the same “createX” factory pattern.
- Error handling is centralized:
  - Routes don’t do elaborate validation (inputs are assumed well-formed per task spec in [task.md](task.md)).
  - Unhandled errors should bubble to the Express error middleware (`createErrorHandler`) which logs via pino and returns `{ error: "Internal Server Error" }`.
- Domain logic should stay pure and testable (no logging/DB/time inside `src/domain/**`).

## Database and Docker
- Postgres schema is initialized from [db/init.sql](db/init.sql) (table: `executions`).
- Docker dev path is `docker compose up --build` (service listens on port `5000`; DB env vars are set in [docker-compose.yml](docker-compose.yml)).
- Runtime config is via env vars loaded in [src/config/env.ts](src/config/env.ts) (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `PORT`, `LOG_LEVEL`).

## Developer workflows
- Install + typecheck + tests + build:
  - `npm ci`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm start` (requires reachable Postgres; see README)
- Tests:
  - Jest + ts-jest config in [jest.config.js](jest.config.js)
  - Unit tests live under [test/unit](test/unit)
  - Integration-style route tests use `createApp` with a fake service + `supertest` (see [test/integration/enterPathRoute.test.ts](test/integration/enterPathRoute.test.ts))

## When adding/changing behavior
- If changing path computation, update `countUniqueCleaned` and its unit tests in [test/unit/robotPath.test.ts](test/unit/robotPath.test.ts).
- If changing what gets persisted, adjust the DTO in `ExecutionsRepo.insert` + `ExecutionRecord` in [src/domain/types.ts](src/domain/types.ts), and update [db/init.sql](db/init.sql) if the schema changes.
