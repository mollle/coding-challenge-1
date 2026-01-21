# 🎯 Vollständige Interview-Vorbereitung: Robot Cleaner Microservice

> Dieses Dokument erklärt jede Entscheidung im Projekt und bereitet dich auf typische Interview-Fragen vor.

---

## 📋 Inhaltsverzeichnis

1. [Was macht die Anwendung?](#1-was-macht-die-anwendung)
2. [Architektur-Überblick](#2-architektur-überblick)
3. [Schichten-Architektur erklärt](#3-schichten-architektur-erklärt)
4. [Jede Datei im Detail](#4-jede-datei-im-detail)
5. [Dependency Injection Pattern](#5-dependency-injection-pattern)
6. [TypeScript Konzepte](#6-typescript-konzepte)
7. [PostgreSQL Grundlagen](#7-postgresql-grundlagen)
8. [Docker Setup](#8-docker-setup)
9. [Testing Strategie](#9-testing-strategie)
10. [Typische Interview-Fragen & Antworten](#10-typische-interview-fragen--antworten)
11. [Alternative Ansätze](#11-alternative-ansätze)
12. [Erweiterung auf Diagonale Bewegungen](#12-erweiterung-auf-diagonale-bewegungen)
13. [Observability: Monitoring & Debugging](#13-observability-monitoring--debugging)
14. [Skalierung: 10 bis 1 Million Requests/Sekunde](#14-skalierung-10-bis-1-million-requestssekunde)
15. [Deployment in Google Cloud](#15-deployment-in-google-cloud)
16. [Fachbegriffe Glossar](#16-fachbegriffe-glossar)

---

## 1. Was macht die Anwendung?

### Die Aufgabe (aus task.md)
Ein Roboter bewegt sich auf einem Gitter und reinigt jeden Punkt, den er besucht:
- Startet bei Koordinaten `(x, y)`
- Führt Bewegungsbefehle aus: `north`, `east`, `south`, `west`
- Zählt **einzigartige** gereinigte Punkte (Duplikate zählen nicht)
- Speichert das Ergebnis in PostgreSQL
- Gibt den gespeicherten Datensatz zurück

### Beispiel
```
Start: (10, 22)
Commands: east 2, north 1

Besuchte Punkte:
(10,22) → (11,22) → (12,22) → (12,23)
   ↓         ↓          ↓         ↓
Start    Schritt 1   Schritt 2  Schritt 3

Ergebnis: 4 einzigartige Punkte
```

### Wichtig zu verstehen
- Jeder **Zwischenschritt** wird gezählt, nicht nur die Endpunkte!
- Wenn der Roboter zurückgeht, werden bereits besuchte Punkte **nicht** erneut gezählt
- Der **Startpunkt** wird mitgezählt

---

## 2. Architektur-Überblick

```
┌──────────────────────────────────────────────────────────────┐
│                        Client (curl)                         │
└─────────────────────────────┬────────────────────────────────┘
                              │ HTTP POST
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     HTTP Layer (Express)                     │
│  ┌─────────────────┐    ┌─────────────────────────────────┐  │
│  │  routes.ts      │    │  errorHandler.ts                │  │
│  │  - Health Check │    │  - Zentrale Fehlerbehandlung    │  │
│  │  - POST Endpoint│    │  - Logging bei Fehlern          │  │
│  └────────┬────────┘    └─────────────────────────────────┘  │
└───────────┼──────────────────────────────────────────────────┘
            │ ruft auf
            ▼
┌──────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  enterPathService.ts                                    │ │
│  │  - Orchestriert den Ablauf                              │ │
│  │  - Misst die Zeit                                       │ │
│  │  - Ruft Domain-Logik auf                                │ │
│  │  - Speichert via Repository                             │ │
│  └────────┬───────────────────────────────┬────────────────┘ │
└───────────┼───────────────────────────────┼──────────────────┘
            │ nutzt                         │ speichert
            ▼                               ▼
┌───────────────────────────┐   ┌──────────────────────────────┐
│      Domain Layer         │   │    Infrastructure Layer      │
│  ┌─────────────────────┐  │   │  ┌────────────────────────┐  │
│  │  robotPath.ts       │  │   │  │  executionsRepo.ts     │  │
│  │  - Reine Logik      │  │   │  │  - SQL INSERT          │  │
│  │  - Keine I/O        │  │   │  │  - Type Mapping        │  │
│  │  - Leicht testbar   │  │   │  └───────────┬────────────┘  │
│  └─────────────────────┘  │   │              │               │
│  ┌─────────────────────┐  │   │  ┌───────────▼────────────┐  │
│  │  types.ts           │  │   │  │  db.ts                 │  │
│  │  direction.ts       │  │   │  │  - Pool Management     │  │
│  └─────────────────────┘  │   │  │  - Connection Handling │  │
└───────────────────────────┘   │  └───────────┬────────────┘  │
                                └──────────────┼───────────────┘
                                               │
                                               ▼
                                ┌──────────────────────────────┐
                                │         PostgreSQL           │
                                │  ┌────────────────────────┐  │
                                │  │  executions Table      │  │
                                │  │  - id, timestamp       │  │
                                │  │  - commands, result    │  │
                                │  │  - duration            │  │
                                │  └────────────────────────┘  │
                                └──────────────────────────────┘
```

### Warum diese Architektur?

**Layered Architecture** (Schichten-Architektur):
- **Separation of Concerns**: Jede Schicht hat eine klare Aufgabe
- **Testbarkeit**: Domain-Logik kann ohne DB getestet werden
- **Wartbarkeit**: Änderungen in einer Schicht beeinflussen andere nicht
- **Übersichtlichkeit**: Neue Entwickler finden sich schnell zurecht

---

## 3. Schichten-Architektur erklärt

### 3.1 HTTP Layer (`src/http/`)

**Aufgabe**: Empfängt HTTP-Requests und sendet Responses

**routes.ts** - Was passiert hier?
```typescript
app.post("/tibber-developer-test/enter-path", async (req, res) => {
  const body = req.body as EnterPathRequestBody;  // Request Body lesen
  const execution = await service.execute(body);   // Service aufrufen
  res.status(201).json(execution);                 // Response senden
});
```

**Warum so simpel?**
- Die Task-Spezifikation sagt: "All input is considered well-formed"
- Daher keine Validierung nötig
- Hält den Code einfach (KISS-Prinzip)

**errorHandler.ts** - Zentralisierte Fehlerbehandlung
```typescript
// Express Error Middleware (4 Parameter!)
(err, req, res, next) => {
  logger.error({ ... });                           // Fehler loggen
  res.status(500).json({ error: "Internal..." });  // Generische Antwort
}
```

**Die 4 Parameter der Error Middleware erklärt:**

| Parameter | Typ | Bedeutung |
|-----------|-----|-----------|
| `err` | `unknown` | Der geworfene Fehler (kann Error, String, oder beliebig sein) |
| `req` | `Request` | Das Express Request-Objekt (Headers, Body, URL, etc.) |
| `res` | `Response` | Das Express Response-Objekt (zum Senden der Antwort) |
| `next` | `NextFunction` | Funktion um zum nächsten Handler weiterzuleiten |

**Warum genau 4 Parameter?**
- Express erkennt Error-Handler NUR an der Signatur mit 4 Parametern!
- Bei 3 Parametern denkt Express, es ist eine normale Middleware
- Deshalb: `_req`, `_next` mit Underscore = "bewusst nicht verwendet"

```typescript
// ❌ FALSCH - Express erkennt das NICHT als Error Handler!
(err, res) => { res.status(500).json(...) }

// ✅ RICHTIG - Alle 4 Parameter müssen da sein
(err, req, res, next) => { res.status(500).json(...) }
```

**Wann wird `next()` im Error Handler verwendet?**
```typescript
// Beispiel: Fehler an nächsten Error Handler weitergeben
(err, req, res, next) => {
  if (err.type === 'validation') {
    res.status(400).json({ error: err.message });
  } else {
    next(err);  // Weiter zum nächsten Error Handler
  }
}
```

**Warum zentral?**
- DRY (Don't Repeat Yourself)
- Einheitliches Fehlerformat
- Verhindert, dass Stack Traces an den Client gehen (Sicherheit!)

---

### 3.2 Application Layer (`src/application/`)

**Aufgabe**: Orchestriert den Geschäftsprozess (Use Case)

**enterPathService.ts** - Der "Dirigent"
```typescript
execute: async (body) => {
  // 1. Zeit starten
  const startNs = process.hrtime.bigint();
  
  // 2. Domain-Logik aufrufen (pure function)
  const result = countUniqueCleaned(body.start, body.commands);
  
  // 3. Zeit stoppen
  const endNs = process.hrtime.bigint();
  const durationSeconds = Number(endNs - startNs) / 1e9;
  
  // 4. Speichern und zurückgeben
  return repo.insert({ commands: body.commands.length, result, duration });
}
```

**Warum `process.hrtime.bigint()`?**
- Hochpräzise Zeitmessung (Nanosekunden)
- Monotonisch = wird nie zurückgesetzt (anders als `Date.now()`)
- Perfekt für Performance-Messung

**Warum eigene Schicht?**
- Trennt "was passiert" (Application) von "wie berechnet" (Domain)
- Die Domain-Logik weiß nichts von Zeit oder Datenbank
- Macht beides unabhängig testbar

---

### 3.3 Domain Layer (`src/domain/`)

**Aufgabe**: Enthält die reine Geschäftslogik - KEIN I/O!

**robotPath.ts** - Der Algorithmus
```typescript
export function countUniqueCleaned(start: Start, commands: Command[]): number {
  let x = start.x;
  let y = start.y;

  // Set für einzigartige Koordinaten (Duplikate automatisch ignoriert)
  const visited = new Set<string>();
  visited.add(`${x},${y}`);  // Startpunkt zählt!

  for (const command of commands) {
    const { dx, dy } = directionToVector(command.direction);

    // Jeden einzelnen Schritt durchlaufen!
    for (let i = 0; i < command.steps; i += 1) {
      x += dx;
      y += dy;
      visited.add(`${x},${y}`);  // Set ignoriert Duplikate
    }
  }

  return visited.size;
}
```

**Warum `Set<string>` statt Array?**
- Set hat O(1) für Hinzufügen und Prüfen auf Existenz
- Array hätte O(n) für `includes()`
- Bei 10.000 Commands × 100.000 Steps = riesiger Unterschied!

**Warum String als Key (`"x,y"`)?**
- JavaScript Sets können keine Objekte effizient vergleichen
- `{ x: 1, y: 2 } !== { x: 1, y: 2 }` (Referenzvergleich!)
- Strings funktionieren: `"1,2" === "1,2"` ✓

**direction.ts** - Lookup-Tabelle
```typescript
const VECTORS: Record<Direction, Vector> = {
  north: { dx: 0, dy: 1 },   // y erhöhen
  east:  { dx: 1, dy: 0 },   // x erhöhen
  south: { dx: 0, dy: -1 },  // y verringern
  west:  { dx: -1, dy: 0 },  // x verringern
};
```

**Warum Lookup-Tabelle statt Switch/If?**
- O(1) Zugriff
- Keine Verzweigungslogik
- Leicht erweiterbar (z.B. diagonal)
- Deklarativ statt imperativ

**types.ts** - TypeScript Type Definitionen
```typescript
export type Direction = "north" | "east" | "south" | "west";
// Union Type: Nur diese 4 Werte erlaubt!

export type Command = {
  direction: Direction;
  steps: number;
};
```

---

### 3.4 Infrastructure Layer (`src/infrastructure/`)

**Aufgabe**: Kommunikation mit externen Systemen (DB)

**db.ts** - Connection Pool Management
```typescript
const pool = new Pool({
  host: env.db.host,
  max: 10,                      // Max 10 gleichzeitige Connections
  idleTimeoutMillis: 30_000,    // Schließe idle Connections nach 30s
  connectionTimeoutMillis: 5_000, // Timeout nach 5s
});
```

**Warum Connection Pool?**
- Neue DB-Verbindungen sind teuer (TCP Handshake, Auth, etc.)
- Pool recycelt bestehende Verbindungen
- `max: 10` verhindert Überlastung der DB
- Für Microservices Standard-Pattern

**executionsRepo.ts** - Repository Pattern
```typescript
insert: async (data) => {
  const query = `
    INSERT INTO executions (commands, result, duration)
    VALUES ($1, $2, $3)
    RETURNING id, timestamp, commands, result, duration
  `;
  
  const res = await pool.query(query, [data.commands, data.result, data.duration]);
  // Type Mapping: SQL-Typen → TypeScript-Typen
  return {
    id: Number(row.id),        // BIGSERIAL → number
    duration: Number(row.duration), // DOUBLE → number
    ...
  };
}
```

**Warum `$1, $2, $3` statt String-Interpolation?**
- **SQL Injection Schutz!**
- Schlecht: `` `INSERT ... VALUES (${data.commands})` `` 
- Gut: `VALUES ($1, $2, $3)` mit separatem Array
- Parametrisierte Queries = Industrie-Standard

**Warum Type Mapping?**
- PostgreSQL `BIGINT` kommt als String in JavaScript an!
- Explizite Konvertierung verhindert Bugs
- TypeScript garantiert korrekten Rückgabetyp

---

## 4. Jede Datei im Detail

### 4.1 `src/index.ts` - Entrypoint

```typescript
async function main(): Promise<void> {
  // 1. Konfiguration laden
  const env = loadEnv();
  const logger = createLogger(env);

  // 2. Infrastruktur initialisieren (Database)
  const db = await createDb(env, logger);
  
  // 3. Repository erstellen
  const repo = createExecutionsRepo(db.pool);
  
  // 4. Service erstellen (bekommt Repository injiziert)
  const enterPathService = createEnterPathService(repo);

  // 5. Express App erstellen und starten
  const app = createApp({ logger, enterPathService });
  app.listen(env.port, "0.0.0.0", () => {
    logger.info({ msg: "server listening", port: env.port });
  });

  // 6. Graceful Shutdown registrieren
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

**Wichtig**: Dies ist die **Composition Root** - der einzige Ort, wo Abhängigkeiten zusammengesteckt werden!

---

### 4.2 `src/app.ts` - Express App Factory

```typescript
export function createApp(deps: {
  logger: Logger;
  enterPathService: EnterPathService;
}): Express {
  const app = express();
  
  // JSON Body Parser mit 1MB Limit
  app.use(express.json({ limit: "1mb" }));

  // Routes registrieren
  registerRoutes(app, deps.enterPathService);

  // Error Handler (muss NACH Routes kommen!)
  app.use(createErrorHandler(deps.logger));
  
  return app;
}
```

**Warum Factory Function statt direkter Export?**
- Ermöglicht Dependency Injection
- Tests können fake Services übergeben
- Keine globalen Singletons

---

### 4.3 `src/config/env.ts` - Environment Konfiguration

```typescript
export function loadEnv(): Env {
  return {
    port: Number.parseInt(process.env.PORT ?? "5000", 10),
    db: {
      host: process.env.DB_HOST ?? "localhost",
      // ...
    },
    logLevel: (process.env.LOG_LEVEL ?? "info") as Env["logLevel"],
  };
}
```

**12-Factor App Prinzip**: Konfiguration via Environment Variables
- Gleicher Code in Dev/Staging/Prod
- Keine Secrets im Code
- Container-freundlich

### Wie werden Environment Variables gesetzt?

**1. Lokal in der Shell (temporär)**
```bash
# Windows PowerShell
$env:DB_HOST="localhost"; $env:PORT="5000"; npm start

# Linux/Mac
DB_HOST=localhost PORT=5000 npm start
```

**2. In `.env` Datei (für Entwicklung)**
```bash
# .env (NICHT in Git committen!)
PORT=5000
DB_HOST=localhost
DB_PASSWORD=geheim
```
Benötigt Paket wie `dotenv`:
```typescript
import 'dotenv/config';  // Lädt .env automatisch
```

**3. In docker-compose.yml (für Docker)**
```yaml
services:
  app:
    environment:
      PORT: 5000
      DB_HOST: postgres      # Service-Name = Hostname!
      DB_PASSWORD: postgres
```

**4. In Kubernetes (für Produktion)**
```yaml
# ConfigMap für nicht-sensible Werte
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  PORT: "5000"
  DB_HOST: "postgres-service"

# Secret für sensible Werte
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
stringData:
  DB_PASSWORD: "super-geheim"
```

**5. In Cloud-Plattformen (GCP, AWS, Azure)**
- Google Cloud Run: In der UI oder via `gcloud run deploy --set-env-vars`
- AWS ECS: Task Definition → Environment Variables
- Azure: App Settings

**Reihenfolge der Priorität (höher = gewinnt):**
```
1. Explizit in Shell gesetzt
2. docker-compose.yml environment
3. .env Datei
4. Default-Werte im Code (?? "localhost")
```

---

### 4.4 `src/logging/logger.ts` - Structured Logging

```typescript
export function createLogger(env: Pick<Env, "logLevel">): Logger {
  return pino({
    level: env.logLevel,
    base: undefined,          // Kein hostname, pid etc.
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
```

**Warum Pino?**
- Schnellster Node.js Logger
- JSON-Output (maschinenlesbar)
- Perfekt für Container/CloudWatch/ELK

**Warum `Pick<Env, "logLevel">`?**
- TypeScript Utility Type
- Sagt: "Brauche nur `logLevel` von `Env`"
- Macht Dependencies explizit

---

### 4.5 `db/init.sql` - Database Schema

```sql
CREATE TABLE IF NOT EXISTS executions (
  id BIGSERIAL PRIMARY KEY,           -- Auto-increment
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  commands INTEGER NOT NULL,
  result BIGINT NOT NULL,             -- Kann groß werden!
  duration DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executions_timestamp_desc
  ON executions (timestamp DESC);
```

**Warum BIGSERIAL/BIGINT?**
- `result` kann bei 10.000 × 100.000 Steps sehr groß werden
- INTEGER hat Limit bei ~2 Milliarden
- BIGINT ist zukunftssicher

**Warum Index auf timestamp?**
- Häufige Query: "Zeige letzte Executions"
- `ORDER BY timestamp DESC` wird durch Index beschleunigt
- Ohne Index: Full Table Scan = langsam

### Wie funktionieren Datenbank-Indexe?

**Was ist ein Index?**
Ein Index ist wie ein Inhaltsverzeichnis in einem Buch:
- Ohne Index: Jede Seite durchblättern (Full Table Scan)
- Mit Index: Direkt zur richtigen Seite springen

**Datenstruktur: B-Tree (Standard in PostgreSQL)**
```
                    [50]
                   /    \
              [25]        [75]
             /    \      /    \
          [10,20] [30,40] [60,70] [80,90]
              ↓       ↓       ↓       ↓
           Zeilen  Zeilen  Zeilen  Zeilen
```

- Sortierte Baumstruktur
- O(log n) für Suche statt O(n)
- Bei 1 Million Zeilen: ~20 Vergleiche statt 1.000.000

**Wann wird der Index aktualisiert?**

```sql
-- INSERT: Index wird SOFORT aktualisiert
INSERT INTO executions (commands, result, duration) VALUES (2, 4, 0.001);
-- → Neuer Eintrag wird in den B-Tree eingefügt

-- UPDATE auf indizierter Spalte: Index wird aktualisiert
UPDATE executions SET timestamp = now() WHERE id = 1;
-- → Alter Eintrag entfernt, neuer eingefügt

-- DELETE: Index wird aktualisiert
DELETE FROM executions WHERE id = 1;
-- → Eintrag aus B-Tree entfernt
```

**Wann wird der Index VERWENDET (nicht aktualisiert)?**
```sql
-- Diese Query nutzt den Index auf timestamp:
SELECT * FROM executions ORDER BY timestamp DESC LIMIT 5;
-- → Direkt die letzten 5 aus dem Index lesen

-- Diese Query nutzt den Index NICHT:
SELECT * FROM executions WHERE result > 100;
-- → Full Table Scan (kein Index auf result)
```

**Trade-offs von Indexen:**

| Vorteil | Nachteil |
|---------|----------|
| Schnellere Lesezugriffe | Langsamere Schreibzugriffe |
| Sortierung gratis | Mehr Speicherplatz |
| WHERE-Klauseln schneller | Index-Pflege bei jedem INSERT/UPDATE |

**Unser Index im Projekt:**
```sql
CREATE INDEX idx_executions_timestamp_desc
  ON executions (timestamp DESC);
```

- Optimiert für `ORDER BY timestamp DESC`
- Neueste Einträge sind am "Anfang" des Index
- Perfekt für "Zeige letzte N Executions"

**Wann erstellt PostgreSQL automatisch Indexe?**
- `PRIMARY KEY` → Automatisch unique Index
- `UNIQUE` Constraint → Automatisch unique Index
- Foreign Keys → KEIN automatischer Index!

---

## 5. Dependency Injection Pattern

### Was ist Dependency Injection (DI)?

Statt:
```typescript
// ❌ Schlecht: Feste Abhängigkeit
class EnterPathService {
  private repo = new ExecutionsRepo(); // Direkt erstellt
}
```

Besser:
```typescript
// ✅ Gut: Abhängigkeit wird übergeben
function createEnterPathService(repo: ExecutionsRepo) {
  return { execute: async (body) => { ... repo.insert(...) } };
}
```

### Warum DI in diesem Projekt?

1. **Testbarkeit**: 
   ```typescript
   // Im Test: Fake Repository
   const fakeRepo = { insert: async () => ({ id: 1, ... }) };
   const service = createEnterPathService(fakeRepo);
   ```

2. **Flexibilität**: Repository könnte MySQL statt Postgres nutzen

3. **Explizite Abhängigkeiten**: Man sieht sofort, was eine Komponente braucht

### DI ohne Framework

Dieses Projekt nutzt **kein DI Framework** (wie InversifyJS):
- Einfacher für kleine Services
- Weniger "Magic"
- Composition Root in `index.ts` reicht aus

---

## 6. TypeScript Konzepte

### 6.1 Type Aliases vs Interfaces

```typescript
// Type Alias (hier verwendet)
export type Command = {
  direction: Direction;
  steps: number;
};

// Interface (Alternative)
export interface Command {
  direction: Direction;
  steps: number;
}
```

**Wann was?**
- `type` für: Union Types, Funktionstypen, komplexe Typen
- `interface` für: Erweiterbare Objektstrukturen, Klassen
- In diesem Projekt: `type` weil keine Vererbung nötig

### 6.2 Union Types

```typescript
export type Direction = "north" | "east" | "south" | "west";
```

**Vorteile**:
- Compiler prüft, dass nur diese 4 Werte verwendet werden
- Autocomplete in IDE
- Keine Laufzeit-Validierung nötig

### 6.3 Record Type

```typescript
const VECTORS: Record<Direction, Vector> = { ... };
```

`Record<K, V>` = Objekt mit Keys vom Typ K und Values vom Typ V
- Garantiert, dass ALLE Directions definiert sind
- Compiler-Error wenn eine fehlt!

### 6.4 Pick Utility Type

```typescript
function createLogger(env: Pick<Env, "logLevel">): Logger
```

`Pick<T, K>` = Nur bestimmte Properties von T
- Dokumentiert minimale Anforderungen
- Verhindert Zugriff auf nicht benötigte Properties

---

## 7. PostgreSQL Grundlagen

### 7.1 Verbindung (Connection)

```
App  ←───TCP───→  PostgreSQL Server
         ↑
    Connection String:
    host:port/database?user&password
```

### 7.2 Connection Pool

```
┌─────────────────────────────────────┐
│          Connection Pool            │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │Conn1│ │Conn2│ │Conn3│ │Conn4│   │
│  └──┬──┘ └──┬──┘ └─────┘ └─────┘   │
│     │       │      idle    idle    │
└─────┼───────┼──────────────────────┘
      │       │
   Request1  Request2
```

- Pool verwaltet mehrere Verbindungen
- Requests "leihen" sich eine Verbindung
- Nach Query wird sie zurückgegeben (nicht geschlossen!)

### 7.3 SQL Basics

```sql
-- INSERT: Neue Zeile einfügen
INSERT INTO executions (commands, result, duration)
VALUES (2, 4, 0.000123);

-- RETURNING: Direkt die eingefügte Zeile zurückgeben
INSERT INTO ... RETURNING id, timestamp, ...;

-- SELECT: Daten abfragen
SELECT * FROM executions ORDER BY timestamp DESC LIMIT 5;
```

### 7.4 Datentypen Mapping

| PostgreSQL | TypeScript | Anmerkung |
|------------|-----------|-----------|
| `INTEGER` | `number` | Direkt |
| `BIGINT/BIGSERIAL` | `string` → `number` | `pg` liefert String! |
| `DOUBLE PRECISION` | `string` → `number` | `pg` liefert String! |
| `TIMESTAMPTZ` | `string` (ISO) | UTC mit Zeitzone |

---

## 8. Docker Setup

### 8.1 Dockerfile - Multi-Stage Build

```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                  # Installiere ALLE deps
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build           # TypeScript → JavaScript

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev       # NUR production deps!
COPY --from=builder /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/index.js"]
```

**Warum Multi-Stage?**
- Builder: Hat TypeScript, devDependencies (groß!)
- Production: Nur kompiliertes JS + Runtime deps (klein!)
- Image-Größe: ~150MB statt ~500MB

### Warum nicht einfach ein Single-Stage Build?

**Hypothetisches Single-Stage (ohne Multi-Stage):**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev       # ❌ PROBLEM: TypeScript fehlt!
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build           # ❌ FEHLER: tsc nicht installiert!
CMD ["node", "dist/index.js"]
```

**Das Problem:**
- `npm run build` braucht `typescript` (devDependency)
- Mit `--omit=dev` wird TypeScript nicht installiert
- Der Build schlägt fehl!

**Alternative ohne Multi-Stage:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci                  # ALLE deps installieren
COPY . .
RUN npm run build
RUN npm prune --omit=dev    # devDeps nachträglich entfernen
CMD ["node", "dist/index.js"]
```

**Warum ist das schlechter?**

| Aspekt | Multi-Stage | Single-Stage mit prune |
|--------|-------------|------------------------|
| Image-Größe | ~150MB | ~180MB (Cache-Reste) |
| Build-Cache | Optimal | Weniger effizient |
| Sicherheit | Minimale Angriffsfläche | Source Code im Image! |
| Layer | Sauber getrennt | Unnötige Layer |

**Der entscheidende Unterschied:**
```dockerfile
# Multi-Stage: Source Code ist NICHT im finalen Image!
COPY --from=builder /app/dist ./dist  # NUR kompiliertes JS

# Single-Stage: Source Code bleibt im Image
COPY . .  # TypeScript-Source + alles andere
```

**Sicherheitsaspekt:**
- Im Production-Image sollte kein Source Code sein
- Kein `tsconfig.json`, keine `.ts` Dateien
- Angreifer können weniger reverse-engineeren

### 8.2 docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d tibber"]
      interval: 2s

  app:
    depends_on:
      postgres:
        condition: service_healthy  # Warte auf DB!
    restart: on-failure
```

**Wichtige Konzepte**:
- `volumes`: init.sql wird beim ersten Start ausgeführt
- `healthcheck`: Prüft ob Postgres bereit ist
- `depends_on` + `condition`: App startet erst wenn DB healthy

### Warum unterschiedliche Base Images?

**Dockerfile:**
```dockerfile
FROM node:20-alpine  # Node.js Image für unsere App
```

**docker-compose.yml:**
```yaml
postgres:
  image: postgres:16-alpine  # PostgreSQL Image
```

**Das sind zwei völlig unterschiedliche Container!**

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│  ┌─────────────────────┐   ┌─────────────────────────┐  │
│  │  app Container      │   │  postgres Container     │  │
│  │  ┌───────────────┐  │   │  ┌───────────────────┐  │  │
│  │  │ node:20-alpine│  │   │  │ postgres:16-alpine│  │  │
│  │  │ + unser Code  │  │   │  │ (fertige DB)      │  │  │
│  │  └───────────────┘  │   │  └───────────────────┘  │  │
│  │      Port 5000      │   │       Port 5432         │  │
│  └──────────┬──────────┘   └────────────┬────────────┘  │
│             │         Netzwerk          │               │
│             └───────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

**Warum `build:` vs `image:`?**
```yaml
services:
  postgres:
    image: postgres:16-alpine  # Fertiges Image von Docker Hub
  
  app:
    build:
      context: .               # Baue aus unserem Dockerfile
```

- `image:` = Lade fertiges Image herunter
- `build:` = Baue Image aus lokalem Dockerfile

### Docker Compose Grundlagen erklärt

**Was ist Docker Compose?**
- Tool zum Definieren und Starten mehrerer Container
- Eine YAML-Datei beschreibt die gesamte Infrastruktur
- `docker compose up` startet alles

**Wichtige Sections:**

```yaml
services:           # Die Container die gestartet werden
  postgres:
    image: ...      # Welches Image verwenden
    environment:    # Umgebungsvariablen setzen
      POSTGRES_DB: tibber
    ports:          # Port-Mapping: host:container
      - "5432:5432"
    volumes:        # Dateien/Ordner einbinden
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - postgres_data:/var/lib/postgresql/data
    healthcheck:    # Gesundheitsprüfung
      test: ["CMD-SHELL", "pg_isready"]
      interval: 2s
      
  app:
    build: .        # Baue aus Dockerfile im aktuellen Ordner
    depends_on:     # Startreihenfolge
      postgres:
        condition: service_healthy
    restart: on-failure  # Neustart bei Fehler

volumes:            # Persistente Daten (überleben Container-Neustart)
  postgres_data:

networks:           # (Optional) Eigene Netzwerke definieren
  default:          # Standardmäßig werden alle Services verbunden
```

**Volume-Typen:**
```yaml
volumes:
  # Named Volume (Docker verwaltet den Speicherort)
  - postgres_data:/var/lib/postgresql/data
  
  # Bind Mount (lokaler Ordner wird eingebunden)
  - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
  #   ↑ Lokal       ↑ Im Container                    ↑ read-only
```

### Docker Compose → Kubernetes Übergang

**Docker Compose ist für:**
- Lokale Entwicklung
- Kleine Deployments
- Single-Host (ein Server)

**Kubernetes ist für:**
- Produktion
- Multi-Host (Cluster)
- Auto-Scaling, Self-Healing

**Konzept-Mapping:**

| Docker Compose | Kubernetes | Funktion |
|----------------|------------|----------|
| `services:` | `Deployment` | Container-Definition |
| `image:` | `spec.containers[].image` | Welches Image |
| `ports:` | `Service` | Netzwerk-Zugang |
| `volumes:` | `PersistentVolumeClaim` | Persistente Daten |
| `environment:` | `ConfigMap` / `Secret` | Konfiguration |
| `depends_on:` | - (handled anders) | Abhängigkeiten |
| `healthcheck:` | `livenessProbe` / `readinessProbe` | Gesundheit |

**Beispiel: Von docker-compose.yml zu Kubernetes:**

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    ports:
      - "5000:5000"
    environment:
      DB_HOST: postgres
```

**Wird zu (Kubernetes):**

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3  # <-- Das kann Docker Compose nicht!
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: app
        image: myapp:latest
        ports:
        - containerPort: 5000
        envFrom:
        - configMapRef:
            name: app-config

---
# service.yaml (Netzwerk-Zugang)
apiVersion: v1
kind: Service
metadata:
  name: app-service
spec:
  selector:
    app: myapp
  ports:
  - port: 5000
    targetPort: 5000
  type: LoadBalancer  # Extern erreichbar
```

**Tools für die Konvertierung:**
- `kompose convert` - Konvertiert docker-compose.yml zu Kubernetes YAML
- Nicht perfekt, aber guter Startpunkt

---

## 9. Testing Strategie

### 9.1 Test-Pyramide

```
        ╱╲
       ╱  ╲        E2E Tests (hier: keine)
      ╱────╲       - Ganzes System
     ╱      ╲      - Langsam, teuer
    ╱────────╲     
   ╱   Inte-  ╲    Integration Tests
  ╱   gration  ╲   - HTTP Layer + Service (mit Mocks)
 ╱──────────────╲  
╱     Unit       ╲ Unit Tests
╱─────Tests───────╲ - Einzelne Funktionen
                    - Schnell, isoliert
```

### 9.2 Unit Tests (`robotPath.test.ts`)

```typescript
it("returns 4 for the example from the spec", () => {
  const commands = [
    { direction: "east", steps: 2 },
    { direction: "north", steps: 1 },
  ];
  expect(countUniqueCleaned({ x: 10, y: 22 }, commands)).toBe(4);
});

it("does not count overlapping positions twice", () => {
  // Hin und zurück
  const commands = [
    { direction: "east", steps: 3 },
    { direction: "west", steps: 3 },
  ];
  expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(4);
});
```

**Getestet**:
- Spec-Beispiel (Pflicht!)
- Edge Cases (keine Commands, negative Koordinaten)
- Überlappungen
- Performance (10.000 Commands)

### 9.3 Service Test (`enterPathService.test.ts`)

```typescript
it("persists commands count, result and duration", async () => {
  // Fake Repository
  const repo: ExecutionsRepo = {
    insert: async (data) => ({
      id: 123,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  };

  const service = createEnterPathService(repo);
  const record = await service.execute(body);

  expect(record.result).toBe(4);        // Korrekte Berechnung
  expect(record.duration).toBeGreaterThanOrEqual(0);  // Zeit gemessen
});
```

**Warum Fake statt echter DB?**
- Schnell (keine DB-Connection)
- Deterministisch
- Testet nur die Service-Logik

### 9.4 Integration Test (`enterPathRoute.test.ts`)

```typescript
it("returns 201 and the execution record shape", async () => {
  const fakeService = { execute: async () => mockRecord };
  const app = createApp({ logger, enterPathService: fakeService });

  const res = await request(app)
    .post("/tibber-developer-test/enter-path")
    .send(body)
    .expect(201);

  expect(res.body).toHaveProperty("id");
  // ...
});
```

**Testet**:
- HTTP Status Code
- Response Format
- Route funktioniert

---

## 10. Typische Interview-Fragen & Antworten

### Architektur

**F: Warum hast du eine Schichten-Architektur gewählt?**
> A: "Die Schichten-Architektur trennt Verantwortlichkeiten klar: HTTP-Handling, Orchestrierung, Geschäftslogik und Datenzugriff. Das macht den Code testbar - ich kann die Domain-Logik ohne Datenbank testen. Außerdem ist es ein bekanntes Pattern, das andere Entwickler sofort verstehen."

**F: Ist das nicht Over-Engineering für so eine kleine App?**
> A: "Die Task-Spezifikation sagt zwar 'Avoid over-engineering', aber diese Trennung ist Standard-Praxis und kein Over-Engineering. Die Dateien sind klein und fokussiert. Eine einzelne Datei mit allem wäre schwerer zu testen und zu warten."

### Code-Entscheidungen

**F: Warum `Set<string>` statt einer anderen Datenstruktur?**
> A: "Set hat O(1) für add und has. Bei maximal 10.000 Commands × 100.000 Steps könnten das bis zu eine Milliarde Operationen sein. Mit einem Array und `includes()` wäre das O(n²) - viel zu langsam. Der String-Key ist nötig, weil JavaScript Sets Objekte nicht nach Wert vergleichen können."

**F: Warum keine Input-Validierung?**
> A: "Die Spezifikation sagt explizit: 'All input is considered well-formed and syntactically correct; no elaborate validation is required.' Ich folge der Spec. In einer echten Produktionsumgebung würde ich natürlich Validierung hinzufügen, z.B. mit Zod oder Joi."

**F: Warum kein ORM wie TypeORM oder Prisma?**
> A: "Für einen einzelnen INSERT + SELECT ist ein ORM Overkill. Der direkte `pg` Client ist einfacher, schneller und hat weniger Dependencies. Die Spec sagt auch: 'Use built-in libraries where possible.' Ein ORM würde hier keine Vorteile bringen."

### TypeScript

**F: Warum `type` statt `interface`?**
> A: "Für diese einfachen Datenstrukturen sind beide austauschbar. Ich bevorzuge `type` für DTOs und Union Types. `interface` würde ich für Klassen-Verträge oder wenn Vererbung nötig ist verwenden."

**F: Was macht `Record<Direction, Vector>`?**
> A: "Record ist ein TypeScript Utility Type. Er definiert ein Objekt, dessen Keys alle vom Typ Direction sein müssen und dessen Values vom Typ Vector. Das garantiert zur Compile-Zeit, dass ich für jede Direction einen Vektor definiert habe."

### Testing

**F: Warum keine End-to-End Tests mit echter Datenbank?**
> A: "Die Unit- und Integration-Tests decken die Geschäftslogik und HTTP-Layer ab. E2E-Tests mit echter DB wären langsam und flaky. Für diese Challenge reichen die vorhandenen Tests. In Produktion würde ich E2E-Tests in einer CI/CD Pipeline haben."

**F: Wie würdest du die Datenbank mocken?**
> A: "Ich mocke auf Repository-Ebene, nicht auf DB-Ebene. Das ist der Vorteil der Schichten-Architektur: Ich übergebe einfach ein Fake-Repository an den Service. So teste ich die echte Service-Logik ohne DB-Abhängigkeit."

### DevOps

**F: Was passiert im Multi-Stage Docker Build?**
> A: "Stage 1 (builder) installiert alle Dependencies und kompiliert TypeScript zu JavaScript. Stage 2 (production) startet frisch, installiert nur Produktions-Dependencies und kopiert die kompilierten JS-Dateien vom Builder. Das finale Image hat kein TypeScript, keine devDependencies - nur das, was zur Laufzeit nötig ist."

**F: Warum `depends_on` mit `condition: service_healthy`?**
> A: "Ohne healthcheck würde die App starten bevor Postgres bereit ist, und der erste Query würde fehlschlagen. Mit healthcheck wartet Docker, bis Postgres tatsächlich Verbindungen annimmt."

---

## 11. Alternative Ansätze

### 11.1 Algorithmus-Alternativen

**Aktuell: Set mit String-Keys**
```typescript
visited.add(`${x},${y}`);
```

**Alternative 1: Map<number, Set<number>>**
```typescript
// Nested Structure: x → Set von y-Werten
const visited = new Map<number, Set<number>>();
if (!visited.has(x)) visited.set(x, new Set());
visited.get(x)!.add(y);
```
- Pro: Kein String-Encoding
- Contra: Komplexerer Code, marginaler Performance-Unterschied

**Alternative 2: Packed Integer**
```typescript
// x und y in einem Number packen
const key = x * 200001 + y + 100000;  // Offset für negative Zahlen
visited.add(key);
```
- Pro: Schneller als String
- Contra: Overflow-Risiko, weniger lesbar

**Meine Entscheidung**: String-Key ist lesbar und performant genug.

### 11.2 Architektur-Alternativen

**Aktuell: Functional Style mit Factory Functions**
```typescript
export function createEnterPathService(repo): EnterPathService { ... }
```

**Alternative: Klassen**
```typescript
export class EnterPathService {
  constructor(private repo: ExecutionsRepo) {}
  async execute(body) { ... }
}
```
- Pro: Bekannter für OOP-Entwickler
- Contra: Mehr Boilerplate, `this`-Binding Probleme möglich

**Alternative: NestJS Framework**
- Pro: DI eingebaut, mehr Struktur für große Apps
- Contra: Overkill für diese Challenge, mehr Dependencies

### 11.3 Datenbank-Alternativen

**Aktuell: Raw SQL mit pg**

**Alternative: TypeORM**
```typescript
@Entity()
class Execution {
  @PrimaryGeneratedColumn()
  id: number;
  // ...
}
await repo.save(execution);
```
- Pro: Type-safe Queries, Migrations eingebaut
- Contra: Lernkurve, Overhead für 1 Tabelle

**Alternative: Prisma**
```typescript
await prisma.execution.create({ data: { ... } });
```
- Pro: Beste TypeScript Integration
- Contra: Eigener Query Language, Build Step nötig

### 11.4 Input Validation hinzufügen

**Aktuell: Keine Validierung (per Spec)**
```typescript
const body = req.body as EnterPathRequestBody;  // Type Assertion, keine Prüfung!
```

**Option 1: Manuelle Validierung**
```typescript
// In routes.ts
app.post("/tibber-developer-test/enter-path", async (req, res) => {
  const body = req.body;
  
  // Manuelle Prüfungen
  if (!body.start || typeof body.start.x !== 'number' || typeof body.start.y !== 'number') {
    return res.status(400).json({ error: "Invalid start coordinates" });
  }
  
  if (!Array.isArray(body.commands)) {
    return res.status(400).json({ error: "Commands must be an array" });
  }
  
  const validDirections = ['north', 'east', 'south', 'west'];
  for (const cmd of body.commands) {
    if (!validDirections.includes(cmd.direction)) {
      return res.status(400).json({ error: `Invalid direction: ${cmd.direction}` });
    }
    if (typeof cmd.steps !== 'number' || cmd.steps < 1) {
      return res.status(400).json({ error: "Steps must be positive number" });
    }
  }
  
  // Weiter mit validiertem Body...
});
```
- Pro: Keine Dependencies
- Contra: Viel Boilerplate, fehleranfällig

**Option 2: Zod (empfohlen)**
```typescript
// src/http/validation.ts
import { z } from 'zod';

export const enterPathSchema = z.object({
  start: z.object({
    x: z.number().int().min(-100_000).max(100_000),
    y: z.number().int().min(-100_000).max(100_000),
  }),
  commands: z.array(z.object({
    direction: z.enum(['north', 'east', 'south', 'west']),
    steps: z.number().int().min(1).max(100_000),
  })).max(10_000),
});

export type EnterPathInput = z.infer<typeof enterPathSchema>;
```

```typescript
// In routes.ts
import { enterPathSchema } from './validation';

app.post("/tibber-developer-test/enter-path", async (req, res) => {
  const parseResult = enterPathSchema.safeParse(req.body);
  
  if (!parseResult.success) {
    return res.status(400).json({ 
      error: "Validation failed",
      details: parseResult.error.issues 
    });
  }
  
  const body = parseResult.data;  // Jetzt typsicher UND validiert!
  // ...
});
```

**Option 3: express-validator**
```typescript
import { body, validationResult } from 'express-validator';

app.post("/tibber-developer-test/enter-path",
  body('start.x').isInt({ min: -100000, max: 100000 }),
  body('start.y').isInt({ min: -100000, max: 100000 }),
  body('commands').isArray({ max: 10000 }),
  body('commands.*.direction').isIn(['north', 'east', 'south', 'west']),
  body('commands.*.steps').isInt({ min: 1, max: 100000 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // ...
  }
);
```

**Empfehlung für Produktion:**
Zod ist die beste Wahl:
- Schema ist die einzige Quelle der Wahrheit
- TypeScript Types werden automatisch generiert
- Gute Fehlermeldungen
- Composable (Schemas kombinierbar)

### 11.5 Worst-Case Handling: Riesige Requests

**Das Problem:**
```
10.000 Commands × 100.000 Steps = 1 Milliarde Punkte
```

**Speicher-Verbrauch des aktuellen Algorithmus:**
```typescript
const visited = new Set<string>();
// Jeder Punkt: "123456,789012" ≈ 15 Bytes String + Set-Overhead
// 1 Milliarde Punkte × ~50 Bytes = 50 GB RAM! 💥
```

**Lösungsstrategien:**

**1. Request-Limits (einfachste Lösung)**
```typescript
// In routes.ts oder Validation
if (body.commands.length > 10_000) {
  return res.status(400).json({ error: "Too many commands" });
}

const totalSteps = body.commands.reduce((sum, cmd) => sum + cmd.steps, 0);
if (totalSteps > 1_000_000) {  // Max 1 Million Schritte
  return res.status(400).json({ error: "Too many total steps" });
}
```

**Empfehlung für dieses Projekt:**
- Input-Limits sind ausreichend (Spec definiert Grenzen)
- Für echte Produktion: Kombination aus Limits + Timeout + Monitoring

---

## 12. Erweiterung auf Diagonale Bewegungen

### Was müsste geändert werden?

Wenn der Roboter auch diagonal (z.B. `northeast`, `southeast`, `southwest`, `northwest`) laufen soll:

**1. types.ts - Direction erweitern**
```typescript
// Vorher:
export type Direction = "north" | "east" | "south" | "west";

// Nachher:
export type Direction = 
  | "north" | "east" | "south" | "west"
  | "northeast" | "southeast" | "southwest" | "northwest";
```

**2. direction.ts - Neue Vektoren hinzufügen**
```typescript
// Vorher:
const VECTORS: Record<Direction, Vector> = {
  north: { dx: 0, dy: 1 },
  east:  { dx: 1, dy: 0 },
  south: { dx: 0, dy: -1 },
  west:  { dx: -1, dy: 0 },
};

// Nachher:
const VECTORS: Record<Direction, Vector> = {
  north:     { dx: 0,  dy: 1 },
  east:      { dx: 1,  dy: 0 },
  south:     { dx: 0,  dy: -1 },
  west:      { dx: -1, dy: 0 },
  northeast: { dx: 1,  dy: 1 },   // NEU
  southeast: { dx: 1,  dy: -1 },  // NEU
  southwest: { dx: -1, dy: -1 },  // NEU
  northwest: { dx: -1, dy: 1 },   // NEU
};
```

**3. robotPath.ts - KEINE Änderung nötig!**

Das ist das Schöne an der Abstraktion:
```typescript
export function countUniqueCleaned(start: Start, commands: Command[]): number {
  // ... 
  for (const command of commands) {
    const { dx, dy } = directionToVector(command.direction);
    // ↑ Funktioniert automatisch mit neuen Directions!
    
    for (let i = 0; i < command.steps; i += 1) {
      x += dx;
      y += dy;
      visited.add(`${x},${y}`);
    }
  }
  return visited.size;
}
```

Die Logik bleibt identisch - nur die Lookup-Tabelle wird erweitert!

**4. Tests erweitern - robotPath.test.ts**
```typescript
// Neuer Test:
it("handles diagonal movement northeast", () => {
  const commands: Command[] = [
    { direction: "northeast", steps: 3 },
  ];
  // Start (0,0) → (1,1) → (2,2) → (3,3)
  expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(4);
});

it("handles diagonal movement creates correct path", () => {
  const commands: Command[] = [
    { direction: "northeast", steps: 2 },
    { direction: "southwest", steps: 2 },  // Zurück zum Start
  ];
  // (0,0) → (1,1) → (2,2) → (1,1) → (0,0)
  // Aber (1,1) und (0,0) wurden schon besucht!
  expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(3);
});
```

**5. Input Validation anpassen (falls vorhanden)**
```typescript
// Mit Zod:
const directionSchema = z.enum([
  'north', 'east', 'south', 'west',
  'northeast', 'southeast', 'southwest', 'northwest'
]);
```

### Zusammenfassung der Änderungen

| Datei | Änderung | Aufwand |
|-------|----------|---------|
| `types.ts` | Union Type erweitern | 1 Zeile |
| `direction.ts` | 4 neue Vektoren | 4 Zeilen |
| `robotPath.ts` | Keine! | 0 Zeilen |
| `robotPath.test.ts` | Neue Tests | ~20 Zeilen |
| Validation (optional) | Enum erweitern | 1 Zeile |

**Warum ist das so einfach?**
- **Separation of Concerns**: Direction-Mapping ist isoliert
- **Record<Direction, Vector>**: TypeScript zwingt uns, alle Cases abzudecken
- **Keine Verzweigungslogik**: Kein `if (direction === "north")` im Algorithmus

---

## 13. Observability: Monitoring & Debugging

### Was ist Observability?

Die drei Säulen:
```
┌─────────────────────────────────────────────────────────────┐
│                     OBSERVABILITY                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   LOGS      │  │   METRICS   │  │      TRACES         │  │
│  │ Was passiert│  │ Wie viel?   │  │ Wie hängt's zusammen│  │
│  │ Fehler      │  │ Wie schnell?│  │ Request-Flow        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Was existiert bereits im Projekt?

**1. Logging (✓ vorhanden)**
```typescript
// src/logging/logger.ts
import pino from "pino";
export function createLogger(env) {
  return pino({
    level: env.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

// Verwendung:
logger.info({ msg: "server listening", port: env.port });
logger.error({ msg: "request failed", err: { message, stack } });
```

**2. Health Check (✓ vorhanden)**
```typescript
// src/http/routes.ts
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});
```

**3. Duration Tracking (✓ vorhanden)**
```typescript
// src/application/enterPathService.ts
const startNs = process.hrtime.bigint();
// ... computation ...
const durationSeconds = Number(endNs - startNs) / 1e9;
// Wird in DB gespeichert
```

### Was fehlt noch?

**1. Metrics (Prometheus-Format)**
```typescript
// src/metrics/metrics.ts
import promClient from 'prom-client';

// Counter: Wie viele Requests?
export const requestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

// Histogram: Wie lange dauern Requests?
export const requestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 5],
});

// Gauge: Aktuelle Werte (z.B. aktive Connections)
export const activeConnections = new promClient.Gauge({
  name: 'db_connections_active',
  help: 'Number of active database connections',
});
```

```typescript
// Middleware für automatisches Tracking
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    requestCounter.inc({ method: req.method, path: req.path, status: res.statusCode });
    requestDuration.observe({ method: req.method, path: req.path }, duration);
  });
  
  next();
});

// Metrics-Endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});
```

**2. Distributed Tracing (OpenTelemetry)**
```typescript
// src/tracing/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'robot-cleaner',
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

Tracing zeigt den Request-Flow:
```
[HTTP POST /enter-path] 
    └── [enterPathService.execute] 
            ├── [countUniqueCleaned] 
            └── [ExecutionsRepo.insert]
                    └── [PostgreSQL Query]
```

**3. Structured Request Logging**
```typescript
// Middleware für Request-Logging
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  
  logger.info({
    msg: 'request started',
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
  });
  
  res.on('finish', () => {
    logger.info({
      msg: 'request completed',
      requestId,
      statusCode: res.statusCode,
    });
  });
  
  next();
});
```

**4. Health Check erweitern (Readiness + Liveness)**
```typescript
// Liveness: Ist der Prozess am Leben?
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness: Kann der Service Requests verarbeiten?
app.get('/health/ready', async (req, res) => {
  try {
    await db.pool.query('SELECT 1');  // DB erreichbar?
    res.status(200).json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});
```

### Observability Stack für Produktion

```
┌─────────────────────────────────────────────────────────────┐
│                    Observability Stack                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Prometheus  │  │    Jaeger    │  │   Elasticsearch  │   │
│  │   Metrics    │  │   Tracing    │  │      Logs        │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                    │              │
│         └────────────┬────┴────────────┬──────┘              │
│                      │                 │                      │
│              ┌───────▼─────────────────▼───────┐             │
│              │           Grafana               │             │
│              │      Unified Dashboard          │             │
│              └─────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

**Google Cloud Alternative:**
- Logs: Cloud Logging (automatisch)
- Metrics: Cloud Monitoring
- Tracing: Cloud Trace

---

## 14. Skalierung: 10 bis 1 Million Requests/Sekunde

### Aktuelle Kapazität (Single Instance)

```
1 Node.js Prozess + 1 Postgres
≈ 100-500 Requests/Sekunde (abhängig von Command-Größe)
```

### Stufe 1: 10-100 Requests/Sekunde (einfach)

**Was wir haben reicht!**
- Single Container
- Connection Pool (max: 10)
- Postgres kann das locker

```
┌─────────────┐     ┌─────────────┐
│    App      │────▶│  Postgres   │
│  (1 inst.)  │     │  (1 inst.)  │
└─────────────┘     └─────────────┘
```

### Stufe 2: 1.000-10.000 Requests/Sekunde

**Horizontales Skalieren der App:**
```yaml
# Kubernetes Deployment
spec:
  replicas: 10  # 10 App-Instanzen
```

```
                    ┌─────────────┐
                 ┌─▶│   App #1    │─┐
                 │  └─────────────┘  │
┌──────────────┐ │  ┌─────────────┐  │  ┌─────────────┐
│ Load Balancer│─┼─▶│   App #2    │──┼─▶│  Postgres   │
└──────────────┘ │  └─────────────┘  │  │  (Primary)  │
                 │  ┌─────────────┐  │  └─────────────┘
                 └─▶│   App #3    │─┘
                    └─────────────┘
```

**Änderungen nötig:**
- Load Balancer (Cloud LB oder nginx)
- Connection Pool pro Instanz anpassen (max: 5 statt 10)
- Postgres: `max_connections` erhöhen

### Stufe 3: 100.000 Requests/Sekunde

**Datenbankoptimierung:**
```
┌──────────────┐     ┌─────────────┐
│ Load Balancer│     │  Postgres   │
└──────┬───────┘     │  Primary    │
       │             └──────┬──────┘
       │                    │ Replication
   ┌───┴───┐          ┌─────┴─────┐
   │       │          │           │
┌──▼──┐ ┌──▼──┐    ┌──▼──┐     ┌──▼──┐
│App 1│ │App N│    │Read │     │Read │
│     │ │(50) │    │Repl.│     │Repl.│
└──┬──┘ └──┬──┘    └─────┘     └─────┘
   │       │
   │  ┌────▼────┐
   └─▶│PgBouncer│  Connection Pooling
      └────┬────┘
           │
      ┌────▼────┐
      │Postgres │
      │ Primary │
      └─────────┘
```

**Neue Komponenten:**
- **PgBouncer**: Connection Pooler VOR Postgres
  - App öffnet Verbindung zu PgBouncer
  - PgBouncer managed echte DB-Connections
  - Erlaubt 10.000 App-Connections mit 100 DB-Connections

- **Read Replicas** (falls Lesezugriffe):
  - Schreiben → Primary
  - Lesen → Replicas

### Stufe 4: 1 Million Requests/Sekunde

**Architektur-Änderung nötig:**

```
┌─────────────────────────────────────────────────────────────┐
│                         CDN/Edge                             │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    Global Load Balancer                      │
└───────┬─────────────────────┬───────────────────────┬───────┘
        │                     │                       │
┌───────▼───────┐     ┌───────▼───────┐      ┌───────▼───────┐
│   Region EU   │     │   Region US   │      │  Region Asia  │
│  ┌─────────┐  │     │  ┌─────────┐  │      │  ┌─────────┐  │
│  │App Pods │  │     │  │App Pods │  │      │  │App Pods │  │
│  │ (100+)  │  │     │  │ (100+)  │  │      │  │ (100+)  │  │
│  └────┬────┘  │     │  └────┬────┘  │      │  └────┬────┘  │
│       │       │     │       │       │      │       │       │
│  ┌────▼────┐  │     │  ┌────▼────┐  │      │  ┌────▼────┐  │
│  │  Redis  │  │     │  │  Redis  │  │      │  │  Redis  │  │
│  │ Cache   │  │     │  │ Cache   │  │      │  │ Cache   │  │
│  └─────────┘  │     │  └─────────┘  │      │  └─────────┘  │
│       │       │     │       │       │      │       │       │
│  ┌────▼────┐  │     │  ┌────▼────┐  │      │  ┌────▼────┐  │
│  │Postgres │  │     │  │Postgres │  │      │  │Postgres │  │
│  │Regional │◀─┼─────┼──│ Global  │──┼──────┼─▶│Regional │  │
│  └─────────┘  │     │  │ Primary │  │      │  └─────────┘  │
└───────────────┘     └───────────────┘      └───────────────┘
```

**Erforderliche Änderungen:**

1. **Asynchrone Verarbeitung:**
```typescript
// Statt direkt zu berechnen: In Queue einreihen
app.post('/enter-path', async (req, res) => {
  const jobId = await queue.add('compute-path', req.body);
  res.status(202).json({ jobId, status: 'processing' });
});

// Separater Worker verarbeitet
worker.process('compute-path', async (job) => {
  const result = await computePath(job.data);
  await saveResult(job.id, result);
});

// Client pollt oder nutzt WebSocket
app.get('/result/:jobId', async (req, res) => {
  const result = await getResult(req.params.jobId);
  res.json(result);
});
```

2. **Sharding der Datenbank:**
```sql
-- Partitionierung nach Timestamp
CREATE TABLE executions (
  ...
) PARTITION BY RANGE (timestamp);

CREATE TABLE executions_2026_01 PARTITION OF executions
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

3. **Caching Layer:**
```typescript
// Redis für häufige/identische Requests
const cacheKey = hash(JSON.stringify(body));
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const result = await compute(body);
await redis.setex(cacheKey, 3600, JSON.stringify(result));
```

### Skalierungs-Cheatsheet

| Requests/s | App Instanzen | DB Setup | Extras |
|------------|---------------|----------|--------|
| 10 | 1 | Single Postgres | - |
| 100 | 1-2 | Single Postgres | - |
| 1.000 | 5-10 | Postgres + PgBouncer | Monitoring |
| 10.000 | 20-50 | Primary + Read Replicas | Auto-scaling |
| 100.000 | 100+ | Sharding | Caching, Queue |
| 1.000.000 | 300+ Multi-Region | Globally Distributed | Complete Redesign |

---

## 15. Deployment in Google Cloud

### Option 1: Cloud Run (empfohlen für Microservices)

**Vorteile:**
- Serverless (zahle nur bei Nutzung)
- Auto-scaling (0 bis 1000 Instanzen)
- Managed SSL
- Einfaches Deployment

**Schritte:**

**1. Projekt erstellen & CLI einrichten**
```bash
# Google Cloud SDK installieren
# https://cloud.google.com/sdk/docs/install

gcloud auth login
gcloud projects create tibber-robot-cleaner
gcloud config set project tibber-robot-cleaner
```

**2. Artifact Registry für Docker Images**
```bash
# Container Registry aktivieren
gcloud services enable artifactregistry.googleapis.com

# Repository erstellen
gcloud artifacts repositories create docker-repo \
  --repository-format=docker \
  --location=europe-west1
```

**3. Docker Image bauen und pushen**
```bash
# Image taggen für GCR
docker build -t europe-west1-docker.pkg.dev/tibber-robot-cleaner/docker-repo/app:v1 .

# Authentifizieren
gcloud auth configure-docker europe-west1-docker.pkg.dev

# Pushen
docker push europe-west1-docker.pkg.dev/tibber-robot-cleaner/docker-repo/app:v1
```

**4. Cloud SQL (Postgres) erstellen**
```bash
gcloud services enable sqladmin.googleapis.com

gcloud sql instances create tibber-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=europe-west1

gcloud sql databases create tibber --instance=tibber-db

gcloud sql users set-password postgres \
  --instance=tibber-db \
  --password=SUPER_SECURE_PASSWORD
```

**5. Cloud Run Service deployen**
```bash
gcloud services enable run.googleapis.com

gcloud run deploy robot-cleaner \
  --image=europe-west1-docker.pkg.dev/tibber-robot-cleaner/docker-repo/app:v1 \
  --platform=managed \
  --region=europe-west1 \
  --port=5000 \
  --allow-unauthenticated \
  --set-env-vars="DB_HOST=/cloudsql/tibber-robot-cleaner:europe-west1:tibber-db" \
  --set-env-vars="DB_NAME=tibber" \
  --set-env-vars="DB_USER=postgres" \
  --set-secrets="DB_PASSWORD=db-password:latest" \
  --add-cloudsql-instances=tibber-robot-cleaner:europe-west1:tibber-db
```

**6. Secret für DB Password**
```bash
gcloud services enable secretmanager.googleapis.com

echo -n "SUPER_SECURE_PASSWORD" | gcloud secrets create db-password --data-file=-

gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Option 2: Google Kubernetes Engine (GKE)

**Wann GKE statt Cloud Run?**
- Mehr Kontrolle nötig
- Komplexe Networking-Anforderungen
- Mehrere Services mit Service Mesh
- Bereits Kubernetes-Erfahrung

**Kubernetes Manifests:**

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: robot-cleaner
spec:
  replicas: 3
  selector:
    matchLabels:
      app: robot-cleaner
  template:
    metadata:
      labels:
        app: robot-cleaner
    spec:
      containers:
      - name: app
        image: europe-west1-docker.pkg.dev/tibber-robot-cleaner/docker-repo/app:v1
        ports:
        - containerPort: 5000
        env:
        - name: DB_HOST
          value: "postgres-service"
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: robot-cleaner-service
spec:
  selector:
    app: robot-cleaner
  ports:
  - port: 80
    targetPort: 5000
  type: LoadBalancer
```

**Deploy to GKE:**
```bash
# Cluster erstellen
gcloud container clusters create tibber-cluster \
  --num-nodes=3 \
  --region=europe-west1

# Credentials holen
gcloud container clusters get-credentials tibber-cluster --region=europe-west1

# Manifests anwenden
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml

# Status prüfen
kubectl get pods
kubectl get services
```

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        
    - name: Install & Test
      run: |
        npm ci
        npm run typecheck
        npm test
        
    - name: Authenticate to Google Cloud
      uses: google-github-actions/auth@v2
      with:
        credentials_json: ${{ secrets.GCP_SA_KEY }}
        
    - name: Configure Docker
      run: gcloud auth configure-docker europe-west1-docker.pkg.dev
      
    - name: Build and Push
      run: |
        docker build -t europe-west1-docker.pkg.dev/${{ secrets.GCP_PROJECT }}/docker-repo/app:${{ github.sha }} .
        docker push europe-west1-docker.pkg.dev/${{ secrets.GCP_PROJECT }}/docker-repo/app:${{ github.sha }}
        
    - name: Deploy to Cloud Run
      uses: google-github-actions/deploy-cloudrun@v2
      with:
        service: robot-cleaner
        region: europe-west1
        image: europe-west1-docker.pkg.dev/${{ secrets.GCP_PROJECT }}/docker-repo/app:${{ github.sha }}
```

### Kosten-Überblick (Stand 2026)

| Service | Spec | ~Kosten/Monat |
|---------|------|---------------|
| Cloud Run | 1 vCPU, 512MB, ~100k requests | $5-20 |
| Cloud SQL (Postgres) | db-f1-micro | ~$10 |
| Artifact Registry | <1GB | ~$0.10 |
| **Gesamt (minimal)** | | **~$15-30** |

**Tipps zur Kostenoptimierung:**
- Cloud Run: `min-instances=0` für Dev
- Cloud SQL: Stoppen wenn nicht gebraucht
- Committed Use Discounts für Produktion

---

## 16. Fachbegriffe Glossar

| Begriff | Erklärung |
|---------|-----------|
| **Microservice** | Kleine, unabhängige Anwendung mit einer spezifischen Aufgabe |
| **REST API** | HTTP-basierte Schnittstelle mit Ressourcen und Standard-Methoden |
| **Dependency Injection** | Abhängigkeiten von außen übergeben statt intern erstellen |
| **Repository Pattern** | Abstraktion für Datenzugriff (versteckt SQL/DB-Details) |
| **Factory Function** | Funktion die Objekte erstellt (statt `new Class()`) |
| **Connection Pool** | Verwaltete Menge wiederverwendbarer DB-Verbindungen |
| **Middleware** | Funktion die zwischen Request und Response sitzt |
| **Multi-Stage Build** | Docker Build mit mehreren `FROM` Statements |
| **Graceful Shutdown** | Sauberes Herunterfahren (Requests abschließen, Connections schließen) |
| **12-Factor App** | Methodologie für cloud-native Apps (Config via Env, etc.) |
| **KISS** | Keep It Simple, Stupid - Einfachheit bevorzugen |
| **DRY** | Don't Repeat Yourself - Duplikation vermeiden |
| **SOLID** | 5 OOP-Prinzipien (hier relevant: Single Responsibility, DI) |
| **O(1), O(n)** | Big-O Notation - Wie skaliert ein Algorithmus? |
| **Monotonic Clock** | Uhr die nie zurückspringt (für Zeitmessung) |
| **Parametrisierte Query** | SQL mit Platzhaltern statt String-Interpolation |
| **DTO** | Data Transfer Object - Datenstruktur für API-Kommunikation |
| **Union Type** | TypeScript: Wert kann einer von mehreren Typen sein |
| **Type Assertion** | `as Type` - Sagt dem Compiler "vertrau mir" |
| **B-Tree** | Balancierte Baumstruktur für Datenbank-Indexe |
| **HyperLogLog** | Probabilistische Datenstruktur für Kardinalitätsschätzung |
| **Sharding** | Aufteilen von Daten auf mehrere Datenbanken |
| **Circuit Breaker** | Pattern zum Schutz vor kaskadierten Fehlern |
| **PgBouncer** | Connection Pooler für PostgreSQL |
| **Read Replica** | Schreibgeschützte Kopie der Datenbank |
| **Load Balancer** | Verteilt Traffic auf mehrere Server |
| **Horizontal Scaling** | Mehr Instanzen hinzufügen |
| **Vertical Scaling** | Größere Maschine verwenden |
| **Serverless** | Infrastruktur wird automatisch verwaltet |
| **Artifact Registry** | Speicher für Container Images |
| **Service Mesh** | Netzwerk-Layer für Microservices (z.B. Istio) |

---

## 🎯 Quick Reference für das Interview

### Die wichtigsten Punkte zum Merken:

1. **Architektur**: 4 Schichten (HTTP → Application → Domain → Infrastructure)
2. **Domain ist pure**: Keine I/O, nur Logik, leicht testbar
3. **DI ohne Framework**: Factory Functions + Composition Root in index.ts
4. **Set für Duplikate**: O(1) statt O(n) - wichtig für Performance
5. **Parametrisierte Queries**: `$1, $2, $3` gegen SQL Injection
6. **Multi-Stage Docker**: Builder → Production (kleineres Image, kein Source Code)
7. **Keine Validierung**: Spec sagt "well-formed input"
8. **Error Handler**: 4 Parameter (err, req, res, next) - Express erkennt das Pattern
9. **Connection Pool**: Recycelt DB-Verbindungen, verhindert Overhead
10. **Indexe**: B-Tree Struktur, werden bei INSERT/UPDATE aktualisiert

### Skalierungs-Antwort:

> "Für 100 req/s reicht die aktuelle Architektur. Für 10.000 req/s würde ich horizontal skalieren mit Load Balancer + PgBouncer. Für 1 Million req/s bräuchte man asynchrone Verarbeitung mit Queue, Caching, und Multi-Region Deployment."

### Wenn du unsicher bist:

> "Ich habe mich für den einfachsten Ansatz entschieden, der die Anforderungen erfüllt. In einer Produktionsumgebung würde ich [X] anders machen, aber für diese Challenge wollte ich Over-Engineering vermeiden."

### Diagonale Bewegungen:

> "Das wäre einfach zu erweitern - nur 2 Dateien ändern: Union Type um 4 Directions erweitern und 4 neue Vektoren in der Lookup-Tabelle. Der Algorithmus in robotPath.ts bleibt unverändert - das zeigt den Vorteil der Abstraktion."


# Open
Amazon S3 und blob sotrage

interview prep lesen

beim ausführen von npm ci: 
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful. 



dese datei und task.md aus repo löschen


coderabbit  feedback

openapi parsen testen
rationale hinter ext libraries ergänezn

readme aufräumne, vielleicht ieinkürzen


# Serverless Functions vs. Docker Images (AWS & GCP)

## AWS: Lambda vs. ECS Fargate

### AWS Lambda (Serverless Functions)

**Vorteile**
- Kein Infrastruktur-Management, voll gemanagter Service [web:2].
- Pay-per-use, automatische Skalierung bis auf 0 Instanzen, sehr günstig bei sporadischem Traffic [web:4][web:5].
- Sehr schnelle automatische Skalierung auf viele gleichzeitige Aufrufe [web:2].

**Nachteile**
- Zeitlimits für Ausführung und Limits bei Speicher/Containergröße, weniger geeignet für lang laufende Tasks [web:4][web:11].
- Cold Starts können zusätzliche Latenz bringen [web:11].
- Weniger Kontrolle über CPU/RAM und Runtime-Umgebung [web:4].

### AWS ECS Fargate (Docker-Container)

**Vorteile**
- Volle Kontrolle über Docker-Image, Runtime und Konfiguration [web:4].
- Keine festen Zeitlimits, geeignet für dauerhafte Services und konstanten Traffic [web:4][web:5].
- Flexible Ressourcenwahl (vCPUs, RAM, Storage) für Performance-Tuning [web:5].

**Nachteile**
- Bezahlt wird pro bereitgestellter vCPU/RAM-Sekunde, kein echtes Scale-to-Zero [web:2].
- Höherer operativer Aufwand (Tasks, Services, Monitoring, Logging) [web:4][web:5].
- Erfordert mehr Container- und Infrastruktur-Know-how [web:5].

## Google Cloud: Cloud Functions vs. Cloud Run

### Cloud Functions (Serverless Functions)

**Vorteile**
- Automatische Skalierung inklusive Scale-to-Zero, sehr einfaches Deployment einzelner Funktionen [web:7][web:10].
- Ideal für Event-getriebene Workloads (Pub/Sub, Storage Events usw.) [web:7][web:11].
- Minimaler Operations-Aufwand [web:11].

**Nachteile**
- Function-basiert statt generischer Container, eingeschränkte Flexibilität bei komplexen Services [web:10].
- Stateless, keine persistente Verbindung (z. B. zu DB) zwischen Invocations [web:10].
- Cold-Start-Latenz bei selten aufgerufenen Funktionen [web:11].

### Cloud Run (Docker-Container)

**Vorteile**
- Läuft direkt mit Docker-Images, volle Freiheit bei Sprache und Runtime [web:7][web:10].
- Gut geeignet für klassische HTTP-Microservices und Web-APIs [web:10].
- Automatische Skalierung, inkl. starker Integration in andere GCP-Services [web:7].

**Nachteile**
- Etwas mehr Komplexität als Functions, da Container-Build & -Konfiguration nötig sind [web:10].
- Kein so radikales Scale-to-Zero-optimiertes Modell wie pure Functions in allen Konfigurationen [web:7].

## Einordnung für den Tibber-Case

- Der Tibber-Service ist als Docker-Microservice mit HTTP-Endpoint, Berechnungslogik und PostgreSQL-Persistenz gedacht [file:1].
- Für so einen dauerhaften HTTP-Service mit DB-Anbindung passen Container-Ansätze wie **AWS ECS Fargate** oder **Google Cloud Run** typischerweise besser als Serverless Functions, die primär für kurze, zustandslose Funktionen optimiert sind [web:4][web:7][file:1].
