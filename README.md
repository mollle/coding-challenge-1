
# Tibber Robot Cleaner Service

Node.js + TypeScript + Express microservice that simulates a robot moving on a grid and counts the number of unique vertices cleaned, persisting each execution to Postgres.

OpenAPI: [openapi.yaml](openapi.yaml)


## Content

- [Prerequisites](#prerequisites)
- [Quick start (Docker)](#quick-start-docker)
- [API](#api)
- [Assumptions](#assumptions)
- [Implementation Limits](#implementation-limits)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Dependency rationale](#dependency-rationale)
- [Submission note](#submission-note)

## Prerequisites

Before starting, ensure you have installed:

- **Docker Desktop** (Windows/Mac) or **Docker Engine + Docker Compose** (Linux)

### Port Requirements

This project uses the following ports:

- **5432**: PostgreSQL database
- **5000**: Application HTTP server

**Important**: If you already have services running on these ports (e.g., a local PostgreSQL instance), you have can change the exposed ports in [docker-compose.yml](docker-compose.yml):

   ```yaml
   # Change postgres mapping from "5432:5432" to e.g. "5433:5432"
   # Change app mapping from "5000:5000" to e.g. "5001:5000"
   ```

## Quick start (Docker)

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

### Stop and cleanup

```bash
# Stop containers (keeps data)
docker compose down

# Stop containers and remove volumes (deletes all data)
docker compose down -v
```

## API

OpenAPI specification: see [openapi.yaml](openapi.yaml)

- `POST /tibber-developer-test/enter-path`
	- Request body: `{ start: { x: number, y: number }, commands: Array<{ direction: "north"|"east"|"south"|"west", steps: number }> }`
	- Response: created execution record (see example above)

Semantics: the robot cleans the start vertex and every intermediate vertex along each step (not only the stop points).

## Assumptions

- Input is syntactically well-formed (directions are valid, numbers are within reasonable bounds).
- Coordinates are in range `[-100_000, 100_000]` per axis.
- No more that 10,000 commands per request.
- No more than 99,999 steps per command.
- The robot is never instructed to move outside the office bounds.
- The service performs only minimal request validation and relies on the caller to provide valid data.
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

## Local development

If you prefer to run the application directly (without Docker):

### Prerequisites

- Node.js 20+ and npm
- PostgreSQL 16+ running locally

### Setup PostgreSQL

1. Create database and user:
   ```bash
   # Connect to your PostgreSQL instance
   psql -U postgres
   
   # Create database
   CREATE DATABASE tibber;
   
   # (Optional) Create dedicated user
   CREATE USER tibber_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE tibber TO tibber_user;
   ```

2. Initialize schema:
   ```bash
   psql -U postgres -d tibber -f db/init.sql
   ```

### Run the application

```bash
# Install dependencies
npm ci

# Type check
npm run typecheck

# Run tests
npm test

# Build TypeScript
npm run build

# Set environment variables (adjust if needed)
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=tibber
export DB_USER=postgres
export DB_PASSWORD=postgres
export PORT=5000
export LOG_LEVEL=info

# Start the application
npm start
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

- `express`: HTTP server and routing
- `pg`: PostgreSQL client (no ORM)
- `pino`: structured logging
- `jest`, `ts-jest`, `supertest`: unit/integration testing

## Submission note

Remove the `.git` directory before packaging the project as a ZIP.