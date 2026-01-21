OpenAPI: [openapi.yaml](openapi.yaml)

# Tibber Robot Cleaner Service

Node.js + TypeScript + Express microservice that simulates a robot moving on a grid and counts the number of unique vertices cleaned, persisting each execution to Postgres.

## Table of contents

- [Prerequisites](#prerequisites)
- [Quick start (Docker)](#quick-start-docker)
- [Troubleshooting](#troubleshooting)
- [API](#api)
- [Assumptions](#assumptions)
- [Implementation Limits](#implementation-limits)
- [Configuration](#configuration)
- [Observability](#observability)
- [Operations](#operations)
- [Local development](#local-development)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Dependency rationale](#dependency-rationale)

## Prerequisites

Before starting, ensure you have installed:

- **Docker Desktop** (Windows/Mac) or **Docker Engine + Docker Compose** (Linux)

### Port Requirements

- **5000**: Application HTTP server (required)
- **5432**: PostgreSQL database (**published for local testing/inspection**)

If ports are in use, change the host mappings in [docker-compose.yml](docker-compose.yml).
 

## Quick start (Docker)

This repository includes a committed [.env](.env) with non-secret defaults so `docker compose up` works on a fresh machine without any preconfigured secrets.

Running `docker compose up` will:

- build the app image from [Dockerfile](Dockerfile) (TypeScript → JavaScript)
- start PostgreSQL (postgres:16-alpine) and initialize the schema from [db/init.sql](db/init.sql) on first startup
- start the app after the Postgres healthcheck passes (listens on port 5000)
- persist database data in the `postgres_data` Docker volume

### Start the services

```bash
docker compose up
```

If you've changed dependencies or application code and want to force a rebuild:

```bash
docker compose up --build
```

You should see log output indicating:
- PostgreSQL is ready to accept connections
- Application started and listening on port 5000

### Verify the setup

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

PowerShell:

```powershell
$json = '{"start":{"x":10,"y":22},"commands":[{"direction":"east","steps":2},{"direction":"north","steps":1}]}'; $json | curl.exe -s -X POST http://localhost:5000/tibber-developer-test/enter-path -H "Content-Type: application/json" --data-binary "@-"
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
docker compose exec postgres psql -U postgres -d tibber -c "SELECT * FROM executions ORDER BY timestamp DESC LIMIT 5;"
```

### Stop and cleanup

```bash
# Stop containers (keeps data)
docker compose down

# Stop containers and remove volumes (deletes all data)
docker compose down -v
```

## Troubleshooting

- Ports already in use: change the *host* port mappings in [docker-compose.yml](docker-compose.yml) (the app still listens on container port `5000`).
- Check container status: `docker compose ps`
- Follow logs: `docker compose logs -f postgres` and `docker compose logs -f app`
- Postgres not healthy: inspect `docker compose logs postgres` for init errors; a fresh start can help: `docker compose down -v` then `docker compose up --build`
- Request fails with `503 Service Unavailable`: the app could not reach Postgres (verify DB container is healthy and credentials in `.env` / container environment)

## API

OpenAPI specification: see [openapi.yaml](openapi.yaml)

- `GET /health`
  - Health check endpoint
  - Response: `{ "status": "ok" }`

- `POST /tibber-developer-test/enter-path`
  - Request body: `{ start: { x: number, y: number }, commands: Array<{ direction: "north"|"east"|"south"|"west", steps: number }> }`
  - Response: created execution record (see example above)

Semantics: the robot cleans the start vertex and every intermediate vertex along each step (not only the stop points).

### Error responses

All error responses are JSON with shape `{ "error": "..." }`.

- `400 Bad Request`: invalid JSON or invalid request body types/shape
- `404 Not Found`: unknown route
- `413 Payload Too Large`: request body exceeds the JSON limit (1MB)
- `503 Service Unavailable`: database unavailable
- `500 Internal Server Error`: unexpected server error

## Assumptions

- Input is expected to be well-formed; the service performs only minimal shape/type checks.
- Coordinates are in range `[-100_000, 100_000]` per axis.
- No more than 10,000 commands per request.
- No more than 99,999 steps per command.
- The robot is never instructed to move outside the office bounds.
- Typical office scenarios are assumed; adversarial inputs designed to maximize unique positions (up to ~1 billion) would exceed available memory.

## Implementation Limits

This implementation uses a `Set<number>` to track visited positions. Each coordinate
pair is encoded as a single number for memory efficiency.

### Memory Constraints (512 MB container)

When the container is limited to 512 MB, Node/V8 will typically cap the JavaScript heap well below that (cgroup-aware). In a quick probe inside `node:20-alpine` with `--memory=512m`, the V8 heap limit was ~259 MiB.

### Real-World Scale (1 step = 1 cm)

The task models the office as a grid of vertices, so “cleaned” is a count of unique vertices (points). If we additionally assume the distance between adjacent vertices is 1 cm, then each step corresponds to 1 cm of path length.

| Metric | Value |
|--------|-------|
| Max unique vertices before OOM (measured, 512 MB container) | ~8,000,000 |
| Max path length through new territory (worst-case, no revisits) | ~80 km |

### Worst-Case Input

The theoretical maximum (10,000 commands × 99,999 steps = ~1 billion positions) would require tens of GB of RAM. This implementation handles typical office scenarios but will run out of memory on adversarial inputs designed to maximize unique positions.

For production use with extreme inputs, a segment-based algorithm would be needed.

## Configuration

Database connection is configured via environment variables:

- `PORT` (default: `5000`)
- `DB_HOST` (default: `localhost`)
- `DB_PORT` (default: `5432`)
- `DB_NAME` (default: `tibber`)
- `DB_USER` (default: `postgres`)
- `DB_PASSWORD` (default: `postgres`)
- `LOG_LEVEL` (default: `info`)

When running with Docker Compose, the app is configured to connect to Postgres via the service name `postgres` (internal Docker network). When running without Docker, `DB_HOST=localhost` is the typical default.

## Observability

- Logs: structured JSON logs via `pino` (configure with `LOG_LEVEL`). In Docker, use `docker compose logs -f app`.
- Health: `GET /health` is a liveness check and returns `{ "status": "ok" }` (it does not verify database connectivity).

## Operations

- Graceful shutdown: the service handles `SIGINT`/`SIGTERM` and closes the Postgres pool best-effort.
- Database outages: inserts may fail and are surfaced as `503 Service Unavailable`.

## Local development

If you prefer to run the application directly (without Docker):

### Prerequisites

- Node.js 20+ and npm
- PostgreSQL 16+ running locally

### Setup PostgreSQL

```bash
psql -U postgres -c "CREATE DATABASE tibber;"
psql -U postgres -d tibber -f db/init.sql
```

### Run the application

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start  # requires DB_* env vars (see Configuration)
```

## Tests

```bash
npm test

# Run tests with coverage report
npm run test:coverage
```

Coverage output is written to `coverage/` (HTML report: `coverage/lcov-report/index.html`).

## Project structure

The codebase follows a small layered layout to keep domain logic pure and testable:

- `src/http`: Express routes + error handling
- `src/application`: orchestration (timing + calling domain + persistence)
- `src/domain`: pure path/robot logic and types (no I/O)
- `src/infrastructure`: Postgres access (`pg`) and repositories

## Dependency rationale

**Runtime dependencies:**

- **`express`** – Minimal, widely-adopted HTTP server framework with good middleware ecosystem. Chosen for simplicity and familiarity.
- **`pg`** – Native PostgreSQL client with connection pooling built-in. 
- **`pino`** – High-performance structured logger with minimal overhead. Outputs JSON for easy consumption by log aggregators.

**Development dependencies:**

- **`jest`**, **`ts-jest`**, **`supertest`** – Industry-standard testing stack for Node.js/TypeScript. Jest provides test runner, mocking, and coverage tools. `ts-jest` enables native TypeScript support without pre-compilation. `supertest` simplifies HTTP endpoint testing with a clean API for request assertions.