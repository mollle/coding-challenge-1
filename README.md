


# Tibber Robot Cleaner Service

Node.js + TypeScript + Express microservice that simulates a robot moving on a grid and counts the number of unique vertices cleaned, persisting each execution to Postgres.

## Quick start (Docker)

```bash
docker compose up --build
```

Health check:

```bash
curl -s http://localhost:5000/health
```

Run an execution:

```bash
curl -s -X POST http://localhost:5000/tibber-developer-test/enter-path \
	-H "Content-Type: application/json" \
	-d '{
		"start": { "x": 10, "y": 22 },
		"commands": [
			{ "direction": "east", "steps": 2 },
			{ "direction": "north", "steps": 1 }
		]
	}'
```

Response example (created execution):

```json
{
	"id": 1,
	"timestamp": "2026-01-19T12:34:56.789Z",
	"commands": 2,
	"result": 4,
	"duration": 0.000123
}
```

Note: `duration` is measured in seconds and represents path computation time only (it excludes the database insert).

Inspect persisted rows:

```bash
docker compose exec postgres psql -U postgres -d tibber \
	-c "SELECT * FROM executions ORDER BY timestamp DESC LIMIT 5;"
```

## API

- `POST /tibber-developer-test/enter-path`
	- Request body: `{ start: { x: number, y: number }, commands: Array<{ direction: "north"|"east"|"south"|"west", steps: number }> }`
	- Response: created execution record (see example above)

Semantics: the robot cleans the start vertex and every intermediate vertex along each step (not only the stop points).

## Assumptions

- Input is syntactically well-formed (directions are valid, numbers are within reasonable bounds).
- The robot is never instructed to move outside the office bounds.
- The service performs only minimal request validation and relies on the caller to provide valid data.

## Operations

- Health endpoint: `GET /health` (liveness)
- Logging: structured logs via `pino` (see `LOG_LEVEL`)
- Shutdown: best-effort graceful shutdown on `SIGINT`/`SIGTERM` (closes DB pool)

## Configuration

Database connection is configured via environment variables:

- `PORT` (default: `5000`)
- `DB_HOST` (default: `localhost`)
- `DB_PORT` (default: `5432`)
- `DB_NAME` (default: `tibber`)
- `DB_USER` (default: `postgres`)
- `DB_PASSWORD` (default: `postgres`)
- `LOG_LEVEL` (default: `info`)

## Local development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Note: `npm start` requires Postgres to be running and reachable via the env vars above.

## Tests

```bash
npm test
```

## Project structure

The codebase follows a small layered layout to keep domain logic pure and testable:

- `src/http`: Express routes + error handling
- `src/application`: orchestration (timing + calling domain + persistence)
- `src/domain`: pure path/robot logic and types (no I/O)
- `src/infrastructure`: Postgres access (`pg`) and repositories

## Dependency rationale

- `express`: HTTP server and routing
- `pg`: PostgreSQL client (no ORM)
- `pino`: structured logging
- `jest`, `ts-jest`, `supertest`: unit/integration testing

## Submission note

Remove the `.git` directory before packaging the project as a ZIP.