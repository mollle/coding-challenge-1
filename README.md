


# Tibber Robot Cleaner Service

Small Node.js + TypeScript + Express service for the Tibber robot-cleaner case study.

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

Inspect persisted rows:

```bash
docker compose exec postgres psql -U postgres -d tibber \
	-c "SELECT * FROM executions ORDER BY timestamp DESC LIMIT 5;"
```

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

## Dependency rationale

- `express`: HTTP server and routing
- `pg`: PostgreSQL client (no ORM)
- `pino`: structured logging
- `jest`, `ts-jest`, `supertest`: unit/integration testing

## Submission note

Remove the `.git` directory before packaging the project as a ZIP.