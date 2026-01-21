


# Tibber Robot Cleaner Service

Node.js + TypeScript + Express microservice that simulates a robot moving on a grid and counts the number of unique vertices cleaned, persisting each execution to Postgres.

## Prerequisites

Before starting, ensure you have installed:

- **Docker Desktop** (Windows/Mac) or **Docker Engine + Docker Compose** (Linux)
  - [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - Verify installation: `docker --version` and `docker compose version`

### Port Requirements

This project uses the following ports:

- **5432**: PostgreSQL database
- **5000**: Application HTTP server

**Important**: If you already have services running on these ports (e.g., a local PostgreSQL instance), you have two options:

1. **Stop conflicting services temporarily**:
   ```bash
   # Example: Stop local PostgreSQL on Windows
   net stop postgresql-x64-16
   
   # Example: Stop local PostgreSQL on Linux/Mac
   sudo systemctl stop postgresql
   # or
   brew services stop postgresql
   ```

2. **Change the exposed ports** in [docker-compose.yml](docker-compose.yml):
   ```yaml
   # Change postgres mapping from "5432:5432" to e.g. "5433:5432"
   # Change app mapping from "5000:5000" to e.g. "5001:5000"
   ```
   Then use the new ports in your curl commands (e.g., `http://localhost:5001/health`).

## Quick start (Docker)

### What happens behind the scenes

Running `docker compose up --build`:

1. **Builds** the Node.js application image from [Dockerfile](Dockerfile)
   - Installs dependencies via npm
   - Compiles TypeScript to JavaScript
   - Creates a production-ready image

2. **Starts PostgreSQL** container (postgres:16-alpine)
   - Initializes database `tibber` with user `postgres`
   - Runs schema setup from [db/init.sql](db/init.sql) (creates `executions` table)
   - Exposes port 5432 to your host machine
   - Persists data in Docker volume `postgres_data`

3. **Starts the application** container
   - Waits for PostgreSQL to be healthy (using healthcheck)
   - Connects to database using environment variables
   - Starts Express server on port 5000
   - Exposes port 5000 to your host machine

### Start the services

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

### Troubleshooting

**Issue**: "port is already allocated" error

**Solution**: Another service is using port 5432 or 5000. See [Port Requirements](#port-requirements) section above.

---

**Issue**: PostgreSQL container keeps restarting

**Solution**: Check logs with `docker compose logs postgres`. Common causes:
- Corrupted volume data: run `docker compose down -v` to remove volumes and start fresh
- Permission issues on Windows with WSL2

---

**Issue**: Application can't connect to database

**Solution**: 
- Ensure PostgreSQL healthcheck passes: `docker compose ps` should show postgres as "healthy"
- Check logs: `docker compose logs app`
- Verify database is reachable: `docker compose exec postgres pg_isready -U postgres -d tibber`

## API

- `POST /tibber-developer-test/enter-path`
	- Request body: `{ start: { x: number, y: number }, commands: Array<{ direction: "north"|"east"|"south"|"west", steps: number }> }`
	- Response: created execution record (see example above)

Semantics: the robot cleans the start vertex and every intermediate vertex along each step (not only the stop points).

## Assumptions

- Input is syntactically well-formed (directions are valid, numbers are within reasonable bounds).
- Coordinates are in range `[-100_000, 100_000]` per axis.
- The robot is never instructed to move outside the office bounds.
- The service performs only minimal request validation and relies on the caller to provide valid data.
- Typical office scenarios are assumed; adversarial inputs designed to maximize unique positions (up to ~1 billion) would exceed available memory.

## Implementation Limits

This implementation uses a `Set<number>` to track visited positions. Each coordinate
pair is encoded as a single number for memory efficiency.

### Memory Constraints (512 MB container)

| Component | Estimated Usage |
|-----------|-----------------|
| Docker + Node.js + App | ~100-150 MB |
| Available for tracking | ~350-400 MB |
| **Max unique positions** | **~7-8 million** |

### Real-World Scale (1 field = 1 cm²)

| Metric | Value |
|--------|-------|
| Max cleanable area | ~700-800 m² |
| Equivalent | Large apartment / small house |

### Worst-Case Input

The theoretical maximum (10,000 commands × 99,999 steps = ~1 billion positions)
would require ~40 GB RAM. This implementation handles typical office scenarios
but will run out of memory on adversarial inputs designed to maximize unique positions.

For production use with extreme inputs, a segment-based algorithm would be needed.

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

**Windows PowerShell**:
```powershell
$env:DB_HOST="localhost"; $env:DB_PORT="5432"; $env:DB_NAME="tibber"; $env:DB_USER="postgres"; $env:DB_PASSWORD="postgres"; $env:PORT="5000"; $env:LOG_LEVEL="info"; npm start
```

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