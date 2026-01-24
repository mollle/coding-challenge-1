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
// Minimale Validierung: Prüft Struktur + primitive Typen
function validateRequestBody(body: unknown): EnterPathRequestBody {
  if (!isRecord(body)) throw new ValidationError("Request body must be an object");
  if (!isFiniteInteger(body.start?.x)) throw new ValidationError("Invalid 'start' coordinates");
  // ... weitere Prüfungen für commands, direction, steps
  return body as EnterPathRequestBody;
}

app.post("/tibber-developer-test/enter-path", async (req, res, next) => {
  try {
    const body = validateRequestBody(req.body);  // Validierung!
    const execution = await service.execute(body);
    res.status(201).json(execution);
  } catch (err) {
    next(err);  // An Error Handler weiterleiten
  }
});

// 404 für unbekannte Routen
app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});
```

**Warum minimale Validierung?**
- Die Task-Spezifikation sagt: "All input is considered well-formed"
- **ABER**: Wir prüfen trotzdem die Grundstruktur (Typen, Pflichtfelder)
- Keine Range-Checks (z.B. ob x zwischen -100.000 und 100.000 liegt)
- `ValidationError` wird vom Error Handler zu 400 Bad Request

**errorHandler.ts** - Zentralisierte Fehlerbehandlung

Die Error Middleware behandelt verschiedene Fehlertypen:

```typescript
// Custom Error Classes
export class ValidationError extends Error { ... }  // → 400 Bad Request
export class DatabaseError extends Error { ... }    // → 503 Service Unavailable

export function createErrorHandler(logger: Logger) {
  return function errorHandler(err, _req, res, _next) {
    // JSON Parse Error (ungültiges JSON im Body)
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Bad Request: Invalid JSON" });
      return;
    }

    // Payload Too Large (Body > 1MB)
    if (err.type === "entity.too.large" || err.status === 413) {
      res.status(413).json({ error: "Payload Too Large" });
      return;
    }

    // Validation Error (Typ-Prüfung fehlgeschlagen)
    if (err instanceof ValidationError) {
      res.status(400).json({ error: `Bad Request: ${err.message}` });
      return;
    }

    // Database Error (DB nicht erreichbar)
    if (err instanceof DatabaseError) {
      logger.error({ msg: "database unavailable", err: err.message });
      res.status(503).json({ error: "Service Unavailable" });
      return;
    }

    // Alle anderen Fehler → 500
    logger.error({ msg: "request failed", err: { message, stack } });
    res.status(500).json({ error: "Internal Server Error" });
  };
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

**robotPath.ts** - Der Segment-Merging Algorithmus

---

### 🤖 Das Problem: Warum nicht einfach jeden Punkt zählen?

```
Stell dir vor, du zeichnest den Weg des Roboters auf Karopapier:

    Start: (0,0)
    Command: "east 5" (5 Schritte nach rechts)
    
    ·───·───·───·───·───·
    0   1   2   3   4   5
    
    Das sind 6 Punkte (Start + 5 Schritte).
```

**Der naive Ansatz:**
```typescript
// Für jeden einzelnen Schritt einen Punkt speichern
visited.add(0);  // Punkt bei x=0
visited.add(1);  // Punkt bei x=1
visited.add(2);  // Punkt bei x=2
visited.add(3);  // Punkt bei x=3
visited.add(4);  // Punkt bei x=4
visited.add(5);  // Punkt bei x=5
// → 6 Operationen für 5 Schritte
```

**Das Problem bei großen Inputs:**
```
Command: "east 100.000"
→ 100.001 Punkte ins Set einfügen!

10.000 solcher Commands?
→ Potentiell 1.000.000.000 (1 Milliarde) Operationen!
→ JavaScript Set crasht bei ~16.7 Millionen Einträgen
→ "Set maximum size exceeded" 💥
```

---

### 💡 Die Lösung: Speichere LINIEN statt PUNKTE

```
Statt 100.001 Punkte zu speichern...

    ·───·───·───·───·─── ... ───·───·───·
    0   1   2   3   4         99999  100000
    
    (100.001 einzelne Punkte 😰)

...speichern wir nur EINE Linie:

    ════════════════════════════════════════
    "Horizontale Linie bei y=0, von x=0 bis x=100000"
    
    Gespeichert als: { y: 0, x1: 0, x2: 100000 }
    
    (1 Objekt statt 100.001 Punkte 🎉)
```

---

### 📐 Der Algorithmus in 4 Schritten

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │ 1. SAMMELN   │ ──▶ │ 2. MERGEN    │ ──▶ │ 3. ZÄHLEN    │        │
│  │              │     │              │     │              │        │
│  │ Bewegungen   │     │ Überlappende │     │ Punkte pro   │        │
│  │ → Segmente   │     │ Intervalle   │     │ Segment      │        │
│  │              │     │ vereinigen   │     │              │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
│                                                   │                 │
│                                                   ▼                 │
│                                            ┌──────────────┐        │
│                                            │ 4. KORREKTUR │        │
│                                            │              │        │
│                                            │ Schnittpunkte│        │
│                                            │ abziehen     │        │
│                                            └──────────────┘        │
│                                                   │                 │
│                                                   ▼                 │
│                                              ERGEBNIS               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Schritt 1: Bewegungen als Segmente speichern

```
Beispiel-Pfad:
  Start: (1,1)
  Commands: east 3, north 2, west 2, south 1

Zeichnung:
         
    y     
    3     
          1───2───3───4      ← Horizontal: y=1, x geht von 1→4
    2         │       │
              │       │      ← Vertikal links:  x=4, y geht von 1→3
    1     ····│·······│      ← Vertikal rechts: x=2, y geht von 2→3
              │               
    0     ────┼───────────▶ x
          0   1   2   3   4

Der Roboter bewegt sich:
  1. east 3:  von (1,1) nach (4,1)  → Horizontal
  2. north 2: von (4,1) nach (4,3)  → Vertikal  
  3. west 2:  von (4,3) nach (2,3)  → Horizontal
  4. south 1: von (2,3) nach (2,2)  → Vertikal
```

**Code:**
```typescript
// Nach jeder Bewegung: Segment speichern
if (dy === 0) {
  // Horizontal (y bleibt gleich, x ändert sich)
  hSegments.push({ y: 1, x1: 1, x2: 4 });  // east 3
  hSegments.push({ y: 3, x1: 2, x2: 4 });  // west 2
} else {
  // Vertikal (x bleibt gleich, y ändert sich)
  vSegments.push({ x: 4, y1: 1, y2: 3 });  // north 2
  vSegments.push({ x: 2, y1: 2, y2: 3 });  // south 1
}
```

**Gesammelte Segmente:**
```
Horizontal (──):          Vertikal (│):
┌─────────────────┐       ┌─────────────────┐
│ y=1: x von 1→4  │       │ x=4: y von 1→3  │
│ y=3: x von 2→4  │       │ x=2: y von 2→3  │
└─────────────────┘       └─────────────────┘
```

---

### Schritt 2: Überlappende Intervalle mergen

```
Was wenn der Roboter zweimal über dieselbe Stelle läuft?

Beispiel: Roboter geht hin und zurück auf y=5

    Bewegung 1: east 10  →  Segment [0, 10]
    Bewegung 2: west 5   →  Segment [5, 10] (zurück)
    Bewegung 3: east 3   →  Segment [5, 8]  (wieder vor)

Visualisierung der X-Intervalle bei y=5:

    [0─────────────────10]     Segment 1: [0,10]
              [5───────10]     Segment 2: [5,10]  
              [5─────8]        Segment 3: [5,8] 
    
    Diese überlappen! Ohne Merging würden wir Punkte mehrfach zählen.

Nach dem Merging:

    [0─────────────────10]     Ein Intervall: [0,10]
    
    Punkte = 10 - 0 + 1 = 11 ✓
```

**Der Merge-Algorithmus visualisiert:**

```
Eingabe (unsortiert):     Nach Sortierung:       Nach Merging:
                          
[5,8]  [0,10]  [5,10]  →  [0,10] [5,8] [5,10]  →  [0,10]
                          
                          Prüfe: 5 ≤ 10? Ja! → Erweitern
                          Prüfe: 5 ≤ 10? Ja! → Erweitern
                          Fertig: [0, max(10,8,10)] = [0,10]
```

**Code:**
```typescript
function mergeIntervals(intervals) {
  // 1. Sortieren nach Startpunkt
  intervals.sort((a, b) => a.start - b.start);
  
  // 2. Durchlaufen und mergen
  const merged = [];
  let current = intervals[0];  // [0,10]
  
  for (const next of intervals.slice(1)) {
    if (next.start <= current.end + 1) {
      // Überlappen! → Erweitern
      current.end = Math.max(current.end, next.end);
    } else {
      // Lücke! → Neues Intervall starten
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  
  return merged;  // [[0,10]]
}
```

---

### Schritt 3: Punkte zählen

```
Nach dem Merging haben wir saubere, nicht-überlappende Intervalle:

Horizontale Segmente:              Vertikale Segmente:
┌────────────────────────┐        ┌────────────────────────┐
│ y=1: [1,4] → 4 Punkte  │        │ x=4: [1,3] → 3 Punkte  │
│ y=3: [2,4] → 3 Punkte  │        │ x=2: [2,3] → 2 Punkte  │
├────────────────────────┤        ├────────────────────────┤
│ SUMME:      7 Punkte   │        │ SUMME:      5 Punkte   │
└────────────────────────┘        └────────────────────────┘

Formel für Punkte in Intervall [a,b]:
Punkte = b - a + 1

Beispiel: [1,4] → 4 - 1 + 1 = 4 Punkte (nämlich: 1, 2, 3, 4)
```

---

### Schritt 4: Schnittpunkte abziehen ⚠️

```
PROBLEM: Manche Punkte liegen auf BEIDEN - horizontal UND vertikal!

    y
    3     ────●────        Punkt (4,3) liegt auf:
              │            - Horizontaler Linie y=3
    2         │            - Vertikaler Linie x=4
              │            
    1     ────┼────●       Punkt (4,1) liegt auf:
              │            - Horizontaler Linie y=1  
    0     ────┼──────▶ x   - Vertikaler Linie x=4
              4

Diese Punkte wurden DOPPELT gezählt!
→ Einmal bei horizontalPoints
→ Einmal bei verticalPoints

Wir müssen sie wieder ABZIEHEN.
```

**Schnittpunkte finden:**
```
Für jede vertikale Linie (x=4, y von 1 bis 3):
  Prüfe alle horizontalen Linien:
  
  │ Horizontale y=1, x=[1,4]: Ist 4 im Bereich [1,4]? JA → Schnitt bei (4,1)
  │ Horizontale y=3, x=[2,4]: Ist 4 im Bereich [2,4]? JA → Schnitt bei (4,3)

Für jede vertikale Linie (x=2, y von 2 bis 3):
  Prüfe alle horizontalen Linien:
  
  │ Horizontale y=1, x=[1,4]: Ist 2 im Bereich? JA, aber y=1 ∉ [2,3] → KEIN Schnitt
  │ Horizontale y=3, x=[2,4]: Ist 2 im Bereich [2,4]? JA → Schnitt bei (2,3)

Gefundene Schnittpunkte: 3
```

---

### 🧮 Finale Berechnung

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   horizontalPoints  +  verticalPoints  -  intersections     │
│                                                             │
│         7           +        5         -        3           │
│                                                             │
│                         =  9 Punkte                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Kontrolle durch Abzählen im Bild:**
```
    y
    3         2───3───4       Punkte: (2,3), (3,3), (4,3)
              │       │
    2         │       │       Punkte: (2,2), (4,2)
              │       │
    1     1───2───3───4       Punkte: (1,1), (2,1), (3,1), (4,1)
    
    Gezählt: 3 + 2 + 4 = 9 ✓
```

---

### 🚀 Warum ist das so viel besser?

```
┌────────────────────────────────────────────────────────────────────┐
│                    VERGLEICH: NAIV vs. SMART                       │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  NAIVER ANSATZ (Set):                                              │
│  ───────────────────                                               │
│  Command "east 100.000"                                            │
│  → 100.001 × visited.add()                                         │
│  → 100.001 Einträge im Set                                         │
│                                                                    │
│  Bei 10.000 solcher Commands:                                      │
│  → ~1.000.000.000 Einträge                                         │
│  → 💥 CRASH (Set-Limit: ~16.7 Mio)                                 │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  SMART (Segment-Merging):                                          │
│  ────────────────────────                                          │
│  Command "east 100.000"                                            │
│  → 1 × hSegments.push()                                            │
│  → 1 Segment gespeichert                                           │
│                                                                    │
│  Bei 10.000 solcher Commands:                                      │
│  → 10.000 Segmente                                                 │
│  → ✅ KEIN PROBLEM                                                 │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

Performance mit Heavy-Test (10.000 Commands, je ~100.000 Steps):

  Set-basiert:        ❌ "Set maximum size exceeded"
  Segment-Merging:    ✅ 993.737.501 Punkte in 1.6 Sekunden
```

---

### 📝 Der komplette Algorithmus als Pseudocode

```
FUNKTION countUniqueCleaned(start, commands):
    
    hSegments = []  // Horizontale Segmente
    vSegments = []  // Vertikale Segmente
    position = start
    
    // SCHRITT 1: Segmente sammeln
    FÜR JEDEN command IN commands:
        neuPosition = position + (command.direction × command.steps)
        
        WENN horizontale Bewegung:
            hSegments.add(y=position.y, x1=min, x2=max)
        SONST:
            vSegments.add(x=position.x, y1=min, y2=max)
        
        position = neuPosition
    
    // SCHRITT 2 & 3: Mergen und Zählen
    horizontalPoints = 0
    FÜR JEDES y MIT horizontalen Segmenten:
        intervals = alle X-Intervalle bei diesem y
        merged = mergeIntervals(intervals)
        horizontalPoints += summe(interval.end - interval.start + 1)
    
    verticalPoints = 0
    FÜR JEDES x MIT vertikalen Segmenten:
        intervals = alle Y-Intervalle bei diesem x
        merged = mergeIntervals(intervals)
        verticalPoints += summe(interval.end - interval.start + 1)
    
    // SCHRITT 4: Schnittpunkte abziehen
    intersections = 0
    FÜR JEDE vertikale Linie (x, yIntervalle):
        FÜR JEDE horizontale Linie (y, xIntervalle):
            WENN x in xIntervallen UND y in yIntervallen:
                intersections++
    
    RETURN horizontalPoints + verticalPoints - intersections
```

---

### 🔍 Debugging-Walkthrough: Der Code Zeile für Zeile

Hier gehen wir den **echten Code** mit einem konkreten Beispiel durch und zeigen nach jeder wichtigen Zeile den Speicherstand.

**Beispiel-Input:**
```typescript
start = { x: 0, y: 0 }
commands = [
  { direction: "east",  steps: 3 },  // → nach (3,0)
  { direction: "north", steps: 2 },  // → nach (3,2)
  { direction: "west",  steps: 2 },  // → nach (1,2)
  { direction: "south", steps: 1 },  // → nach (1,1)
]
```

**Erwarteter Pfad:**
```
    y
    2     1───2───3      
          │       │      
    1     ·       │      
                  │      
    0     0───1───2───3 → x
```

---

#### Phase 1: Initialisierung

```typescript
export function countUniqueCleaned(start: Start, commands: Command[]): number {
  if (commands.length === 0) {
    return 1;
  }
```
```
┌─────────────────────────────────────────────────────────────┐
│ commands.length = 4  →  Kein early return, weiter geht's   │
└─────────────────────────────────────────────────────────────┘
```

```typescript
  const horizontalSegments: HorizontalSegment[] = [];
  const verticalSegments: VerticalSegment[] = [];

  let currentX = start.x;
  let currentY = start.y;
```
```
┌─────────────────────────────────────────────────────────────┐
│ SPEICHER nach Initialisierung:                              │
├─────────────────────────────────────────────────────────────┤
│ horizontalSegments = []                                     │
│ verticalSegments   = []                                     │
│ currentX = 0                                                │
│ currentY = 0                                                │
└─────────────────────────────────────────────────────────────┘
```

---

#### Phase 2: Segmente sammeln (Loop über Commands)

**Command 1: `{ direction: "east", steps: 3 }`**

```typescript
  for (const command of commands) {
    const { dx, dy } = directionToVector(command.direction);
    const destinationX = currentX + dx * command.steps;
    const destinationY = currentY + dy * command.steps;
```
```
┌─────────────────────────────────────────────────────────────┐
│ command = { direction: "east", steps: 3 }                   │
│ dx = 1, dy = 0  (east = nach rechts)                        │
│ destinationX = 0 + 1 * 3 = 3                                │
│ destinationY = 0 + 0 * 3 = 0                                │
└─────────────────────────────────────────────────────────────┘
```

```typescript
    if (dy === 0) {
      // Horizontal movement (y stays constant, x changes)
      horizontalSegments.push({
        yCoordinate: currentY,
        xStart: Math.min(currentX, destinationX),
        xEnd: Math.max(currentX, destinationX),
      });
    }
```
```
┌─────────────────────────────────────────────────────────────┐
│ dy === 0? JA → Horizontale Bewegung                         │
│                                                             │
│ horizontalSegments.push({                                   │
│   yCoordinate: 0,                                           │
│   xStart: min(0, 3) = 0,                                    │
│   xEnd: max(0, 3) = 3                                       │
│ })                                                          │
├─────────────────────────────────────────────────────────────┤
│ SPEICHER:                                                   │
│ horizontalSegments = [                                      │
│   { yCoordinate: 0, xStart: 0, xEnd: 3 }  ← NEU            │
│ ]                                                           │
│ verticalSegments = []                                       │
└─────────────────────────────────────────────────────────────┘
```

```typescript
    currentX = destinationX;
    currentY = destinationY;
```
```
┌─────────────────────────────────────────────────────────────┐
│ currentX = 3                                                │
│ currentY = 0                                                │
└─────────────────────────────────────────────────────────────┘
```

---

**Command 2: `{ direction: "north", steps: 2 }`**

```typescript
    const { dx, dy } = directionToVector(command.direction);
    const destinationX = currentX + dx * command.steps;
    const destinationY = currentY + dy * command.steps;
```
```
┌─────────────────────────────────────────────────────────────┐
│ command = { direction: "north", steps: 2 }                  │
│ dx = 0, dy = 1  (north = nach oben)                         │
│ destinationX = 3 + 0 * 2 = 3                                │
│ destinationY = 0 + 1 * 2 = 2                                │
└─────────────────────────────────────────────────────────────┘
```

```typescript
    } else {
      // Vertical movement (x stays constant, y changes)
      verticalSegments.push({
        xCoordinate: currentX,
        yStart: Math.min(currentY, destinationY),
        yEnd: Math.max(currentY, destinationY),
      });
    }
```
```
┌─────────────────────────────────────────────────────────────┐
│ dy === 0? NEIN → Vertikale Bewegung                         │
│                                                             │
│ verticalSegments.push({                                     │
│   xCoordinate: 3,                                           │
│   yStart: min(0, 2) = 0,                                    │
│   yEnd: max(0, 2) = 2                                       │
│ })                                                          │
├─────────────────────────────────────────────────────────────┤
│ SPEICHER:                                                   │
│ horizontalSegments = [                                      │
│   { yCoordinate: 0, xStart: 0, xEnd: 3 }                   │
│ ]                                                           │
│ verticalSegments = [                                        │
│   { xCoordinate: 3, yStart: 0, yEnd: 2 }  ← NEU            │
│ ]                                                           │
│ currentX = 3, currentY = 2                                  │
└─────────────────────────────────────────────────────────────┘
```

---

**Command 3: `{ direction: "west", steps: 2 }`**

```
┌─────────────────────────────────────────────────────────────┐
│ command = { direction: "west", steps: 2 }                   │
│ dx = -1, dy = 0  (west = nach links)                        │
│ destinationX = 3 + (-1) * 2 = 1                             │
│ destinationY = 2 + 0 * 2 = 2                                │
│                                                             │
│ dy === 0? JA → Horizontale Bewegung                         │
├─────────────────────────────────────────────────────────────┤
│ SPEICHER:                                                   │
│ horizontalSegments = [                                      │
│   { yCoordinate: 0, xStart: 0, xEnd: 3 },                  │
│   { yCoordinate: 2, xStart: 1, xEnd: 3 }  ← NEU            │
│ ]                                                           │
│ verticalSegments = [                                        │
│   { xCoordinate: 3, yStart: 0, yEnd: 2 }                   │
│ ]                                                           │
│ currentX = 1, currentY = 2                                  │
└─────────────────────────────────────────────────────────────┘
```

---

**Command 4: `{ direction: "south", steps: 1 }`**

```
┌─────────────────────────────────────────────────────────────┐
│ command = { direction: "south", steps: 1 }                  │
│ dx = 0, dy = -1  (south = nach unten)                       │
│ destinationX = 1 + 0 * 1 = 1                                │
│ destinationY = 2 + (-1) * 1 = 1                             │
│                                                             │
│ dy === 0? NEIN → Vertikale Bewegung                         │
├─────────────────────────────────────────────────────────────┤
│ SPEICHER nach allen 4 Commands:                             │
│                                                             │
│ horizontalSegments = [                                      │
│   { yCoordinate: 0, xStart: 0, xEnd: 3 },                  │
│   { yCoordinate: 2, xStart: 1, xEnd: 3 }                   │
│ ]                                                           │
│ verticalSegments = [                                        │
│   { xCoordinate: 3, yStart: 0, yEnd: 2 },                  │
│   { xCoordinate: 1, yStart: 1, yEnd: 2 }  ← NEU            │
│ ]                                                           │
│ currentX = 1, currentY = 1                                  │
└─────────────────────────────────────────────────────────────┘
```

---

#### Phase 3: Horizontale Segmente gruppieren und mergen

```typescript
  const horizontalSegmentsByY = new Map<number, Interval[]>();
  for (const segment of horizontalSegments) {
    if (!horizontalSegmentsByY.has(segment.yCoordinate)) {
      horizontalSegmentsByY.set(segment.yCoordinate, []);
    }
    horizontalSegmentsByY.get(segment.yCoordinate)!.push({
      start: segment.xStart,
      end: segment.xEnd,
    });
  }
```
```
┌─────────────────────────────────────────────────────────────┐
│ Gruppiere horizontale Segmente nach Y-Koordinate:           │
│                                                             │
│ horizontalSegmentsByY = Map {                               │
│   0 → [ { start: 0, end: 3 } ],    // Linie bei y=0        │
│   2 → [ { start: 1, end: 3 } ]     // Linie bei y=2        │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
```

```typescript
  let totalHorizontalPoints = 0;
  const mergedHorizontalIntervalsByY = new Map<number, Interval[]>();

  for (const [yCoordinate, xIntervals] of horizontalSegmentsByY) {
    const mergedXIntervals = mergeOverlappingIntervals(xIntervals);
    mergedHorizontalIntervalsByY.set(yCoordinate, mergedXIntervals);
    totalHorizontalPoints += countPointsInIntervals(mergedXIntervals);
  }
```
```
┌─────────────────────────────────────────────────────────────┐
│ Iteration 1: yCoordinate = 0                                │
│   xIntervals = [ { start: 0, end: 3 } ]                     │
│   mergedXIntervals = [ { start: 0, end: 3 } ]  (keine Überlappung)
│   Punkte: 3 - 0 + 1 = 4                                     │
│   totalHorizontalPoints = 0 + 4 = 4                         │
├─────────────────────────────────────────────────────────────┤
│ Iteration 2: yCoordinate = 2                                │
│   xIntervals = [ { start: 1, end: 3 } ]                     │
│   mergedXIntervals = [ { start: 1, end: 3 } ]  (keine Überlappung)
│   Punkte: 3 - 1 + 1 = 3                                     │
│   totalHorizontalPoints = 4 + 3 = 7                         │
├─────────────────────────────────────────────────────────────┤
│ SPEICHER:                                                   │
│ mergedHorizontalIntervalsByY = Map {                        │
│   0 → [ { start: 0, end: 3 } ],                            │
│   2 → [ { start: 1, end: 3 } ]                             │
│ }                                                           │
│ totalHorizontalPoints = 7                                   │
└─────────────────────────────────────────────────────────────┘
```

---

#### Phase 4: Vertikale Segmente gruppieren und mergen

```typescript
  const verticalSegmentsByX = new Map<number, Interval[]>();
  // ... (analog zu horizontal)

  let totalVerticalPoints = 0;
  const mergedVerticalIntervalsByX = new Map<number, Interval[]>();
  // ... (analog zu horizontal)
```
```
┌─────────────────────────────────────────────────────────────┐
│ Gruppiere vertikale Segmente nach X-Koordinate:             │
│                                                             │
│ verticalSegmentsByX = Map {                                 │
│   3 → [ { start: 0, end: 2 } ],    // Linie bei x=3        │
│   1 → [ { start: 1, end: 2 } ]     // Linie bei x=1        │
│ }                                                           │
├─────────────────────────────────────────────────────────────┤
│ Nach Merging und Zählen:                                    │
│                                                             │
│ mergedVerticalIntervalsByX = Map {                          │
│   3 → [ { start: 0, end: 2 } ],  // Punkte: 2-0+1 = 3      │
│   1 → [ { start: 1, end: 2 } ]   // Punkte: 2-1+1 = 2      │
│ }                                                           │
│ totalVerticalPoints = 3 + 2 = 5                             │
└─────────────────────────────────────────────────────────────┘
```

---

#### Phase 5: Schnittpunkte finden mit Binary Search

```typescript
  let intersectionCount = 0;

  const sortedYCoordinatesWithHorizontalSegments = Array.from(
    mergedHorizontalIntervalsByY.keys()
  ).sort((a, b) => a - b);
```
```
┌─────────────────────────────────────────────────────────────┐
│ sortedYCoordinatesWithHorizontalSegments = [0, 2]           │
│ (sortiert, für Binary Search)                               │
└─────────────────────────────────────────────────────────────┘
```

```typescript
  for (const [verticalLineX, verticalYIntervals] of mergedVerticalIntervalsByX) {
    for (const verticalYInterval of verticalYIntervals) {
      // Binary search für ersten Y-Wert >= verticalYInterval.start
      let searchLow = 0;
      let searchHigh = sortedYCoordinatesWithHorizontalSegments.length;

      while (searchLow < searchHigh) {
        const searchMid = (searchLow + searchHigh) >>> 1;
        if (sortedYCoordinatesWithHorizontalSegments[searchMid] < verticalYInterval.start) {
          searchLow = searchMid + 1;
        } else {
          searchHigh = searchMid;
        }
      }
```

**Vertikale Linie 1: x=3, y=[0,2]**

```
┌─────────────────────────────────────────────────────────────┐
│ verticalLineX = 3                                           │
│ verticalYInterval = { start: 0, end: 2 }                    │
│                                                             │
│ Binary Search für y >= 0:                                   │
│   sortedY = [0, 2]                                          │
│   searchLow=0, searchHigh=2                                 │
│   mid=1: sortedY[1]=2 >= 0? JA → searchHigh=1              │
│   mid=0: sortedY[0]=0 >= 0? JA → searchHigh=0              │
│   Ergebnis: searchLow = 0 (Index des ersten y >= 0)         │
└─────────────────────────────────────────────────────────────┘
```

```typescript
      for (
        let yIndex = searchLow;
        yIndex < sortedYCoordinatesWithHorizontalSegments.length &&
        sortedYCoordinatesWithHorizontalSegments[yIndex] <= verticalYInterval.end;
        yIndex++
      ) {
        const horizontalLineY = sortedYCoordinatesWithHorizontalSegments[yIndex];
        const horizontalXIntervals = mergedHorizontalIntervalsByY.get(horizontalLineY)!;

        for (const horizontalXInterval of horizontalXIntervals) {
          if (verticalLineX >= horizontalXInterval.start && 
              verticalLineX <= horizontalXInterval.end) {
            intersectionCount++;
            break;
          }
        }
      }
```
```
┌─────────────────────────────────────────────────────────────┐
│ Prüfe Y-Koordinaten von Index 0 bis Ende (solange y <= 2):  │
│                                                             │
│ yIndex=0: horizontalLineY = 0                               │
│   horizontalXIntervals = [ { start: 0, end: 3 } ]           │
│   Ist verticalLineX=3 in [0,3]? 3 >= 0 && 3 <= 3 → JA!     │
│   intersectionCount++ → intersectionCount = 1               │
│   Schnittpunkt gefunden: (3, 0) ✓                           │
│                                                             │
│ yIndex=1: horizontalLineY = 2                               │
│   horizontalXIntervals = [ { start: 1, end: 3 } ]           │
│   Ist verticalLineX=3 in [1,3]? 3 >= 1 && 3 <= 3 → JA!     │
│   intersectionCount++ → intersectionCount = 2               │
│   Schnittpunkt gefunden: (3, 2) ✓                           │
│                                                             │
│ yIndex=2: sortedY[2] existiert nicht → Loop beendet         │
└─────────────────────────────────────────────────────────────┘
```

**Vertikale Linie 2: x=1, y=[1,2]**

```
┌─────────────────────────────────────────────────────────────┐
│ verticalLineX = 1                                           │
│ verticalYInterval = { start: 1, end: 2 }                    │
│                                                             │
│ Binary Search für y >= 1:                                   │
│   sortedY = [0, 2]                                          │
│   searchLow=0, searchHigh=2                                 │
│   mid=1: sortedY[1]=2 >= 1? JA → searchHigh=1              │
│   mid=0: sortedY[0]=0 >= 1? NEIN → searchLow=1             │
│   Ergebnis: searchLow = 1 (überspringe y=0, da y=0 < 1)     │
│                                                             │
│ yIndex=1: horizontalLineY = 2                               │
│   horizontalXIntervals = [ { start: 1, end: 3 } ]           │
│   Ist verticalLineX=1 in [1,3]? 1 >= 1 && 1 <= 3 → JA!     │
│   intersectionCount++ → intersectionCount = 3               │
│   Schnittpunkt gefunden: (1, 2) ✓                           │
│                                                             │
│ yIndex=2: existiert nicht → Loop beendet                    │
└─────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────┐
│ SPEICHER nach Schnittpunkt-Berechnung:                      │
│                                                             │
│ intersectionCount = 3                                       │
│                                                             │
│ Gefundene Schnittpunkte:                                    │
│   (3, 0) - Kreuzung von H[y=0] und V[x=3]                  │
│   (3, 2) - Kreuzung von H[y=2] und V[x=3]                  │
│   (1, 2) - Kreuzung von H[y=2] und V[x=1]                  │
└─────────────────────────────────────────────────────────────┘
```

---

#### Phase 6: Finale Berechnung

```typescript
  return totalHorizontalPoints + totalVerticalPoints - intersectionCount;
}
```
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   FINALE BERECHNUNG                                         │
│   ══════════════════                                        │
│                                                             │
│   totalHorizontalPoints  =  7                               │
│   totalVerticalPoints    =  5                               │
│   intersectionCount      =  3                               │
│                                                             │
│   ─────────────────────────────                             │
│   return 7 + 5 - 3 = 9                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

#### Visuelle Verifikation

```
    y
    2     (1,2)───(2,2)───(3,2)      3 Punkte bei y=2
          │               │      
    1     (1,1)           │          1 Punkt (nicht auf H-Linie!)
                          │      
    0     (0,0)───(1,0)───(2,0)───(3,0)    4 Punkte bei y=0
    
          0       1       2       3    x

Manuelles Abzählen aller einzigartigen Punkte:
  y=0: (0,0), (1,0), (2,0), (3,0)           = 4 Punkte
  y=1: (1,1)                                 = 1 Punkt
  y=2: (1,2), (2,2), (3,2)                  = 3 Punkte
  Vertikal extra: (3,1) fehlt!              = 1 Punkt
                                            ─────────
                                    TOTAL   = 9 Punkte ✓
```

---

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
export async function createDb(env: Env, logger: Logger): Promise<Db> {
  const pool = new Pool({
    host: env.db.host,
    max: 10,                      // Max 10 gleichzeitige Connections
    idleTimeoutMillis: 30_000,    // Schließe idle Connections nach 30s
    connectionTimeoutMillis: 5_000, // Timeout nach 5s
  });

  // Connection-Test mit Fehlerbehandlung!
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    // Bei Fehler: Pool aufräumen bevor wir re-thrown
    try {
      await pool.end();
    } catch (closeErr) {
      logger.error({ err: closeErr, msg: "failed to close pool after connection test failure" });
    }
    logger.error({ err, msg: "database connection test failed" });
    throw err;  // Verhindert Start mit kaputter DB-Verbindung
  }
  
  logger.info({ msg: "database connected" });
  return { pool, close: async () => { await pool.end(); } };
}
```

**Warum Connection Pool?**
- Neue DB-Verbindungen sind teuer (TCP Handshake, Auth, etc.)
- Pool recycelt bestehende Verbindungen
- `max: 10` verhindert Überlastung der DB
- Für Microservices Standard-Pattern

**Warum Connection-Test beim Start?**
- Fail-Fast: App startet nicht mit falscher DB-Konfiguration
- Sauberes Cleanup: Pool wird bei Fehler geschlossen
- Klare Logs: Fehlerursache ist sofort sichtbar

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
  const server = app.listen(env.port, "0.0.0.0", () => {
    logger.info({ msg: "server listening", port: env.port });
  });

  // 6. Graceful Shutdown mit Schutz vor doppeltem Aufruf
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;  // Verhindert Race Condition!
    isShuttingDown = true;
    
    logger.info({ msg: "shutdown requested" });
    
    // HTTP Server schließen (mit Fehlerbehandlung)
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    logger.info({ msg: "http server closed" });
    
    // DB Connection Pool schließen
    try {
      await db.close();
    } catch (err) {
      logger.error({ msg: "error closing database", err });
    }
    
    process.exit(0);
  };

  // SIGINT (Ctrl+C) und SIGTERM (Docker/K8s stop)
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
```

**Wichtig**: Dies ist die **Composition Root** - der einzige Ort, wo Abhängigkeiten zusammengesteckt werden!

**Graceful Shutdown Patterns:**
- `isShuttingDown` Flag verhindert doppelten Shutdown bei schnellen SIGINT/SIGTERM
- `void shutdown()` - TypeScript-Pattern für async Handler ohne await
- HTTP Server zuerst schließen (keine neuen Requests annehmen)
- Dann DB Pool schließen (laufende Queries können noch fertig werden)

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
const VALID_LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"];

export function loadEnv(): Env {
  const port = Number.parseInt(process.env.PORT ?? "5000", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT: "${process.env.PORT}" is not a number`);
  }

  const dbPort = Number.parseInt(process.env.DB_PORT ?? "5432", 10);
  if (Number.isNaN(dbPort)) {
    throw new Error(`Invalid DB_PORT: "${process.env.DB_PORT}" is not a number`);
  }

  const rawLogLevel = process.env.LOG_LEVEL ?? "info";
  if (!VALID_LOG_LEVELS.includes(rawLogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
  }

  return {
    port,
    db: { host: process.env.DB_HOST ?? "localhost", port: dbPort, ... },
    logLevel: rawLogLevel as Env["logLevel"],
  };
}
```

**Fail-Fast Validation:**
- Prüft PORT und DB_PORT auf gültige Zahlen
- Prüft LOG_LEVEL gegen erlaubte Werte
- Wirft Fehler mit klarer Meldung bei ungültiger Konfiguration
- App startet nicht mit kaputten Env-Variablen

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
# .env - In diesem Projekt MIT Defaults committed!
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tibber
DB_USER=postgres
DB_PASSWORD=postgres
```

**Hinweis zu diesem Projekt:**
- `.env` ist committed mit nicht-sensiblen Defaults
- Ermöglicht `docker compose up` ohne Konfiguration
- **Produktions-Secrets** kommen aus Secret Manager, nicht aus `.env`!

Normalerweise mit `dotenv` Paket:
```typescript
import 'dotenv/config';  // Lädt .env automatisch
```
(Dieses Projekt nutzt Docker's `env_file:` statt dotenv)

**3. In docker-compose.yml (für Docker)**
```yaml
services:
  app:
    env_file:
      - .env                  # Lädt alle Variablen aus .env
    environment:
      DB_HOST: postgres       # Überschreibt DB_HOST aus .env!
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
    env_file:
      - .env                    # Lädt Variablen aus .env Datei!
    environment:
      POSTGRES_DB: ${DB_NAME}   # Variable Substitution
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 2s

  app:
    build:
      context: .
    env_file:
      - .env                    # Lädt gleiche .env Datei
    environment:
      NODE_ENV: production
      DB_HOST: postgres         # Überschreibt DB_HOST aus .env!
    depends_on:
      postgres:
        condition: service_healthy  # Warte auf DB!
    restart: on-failure
```

**Wichtige Konzepte**:
- `env_file`: Lädt Variablen aus `.env` Datei (committed mit Defaults!)
- `${VARIABLE}`: Variable Substitution - Wert wird aus `.env` gelesen
- `environment`: Kann Werte aus `env_file` überschreiben (z.B. `DB_HOST: postgres`)
- `volumes`: init.sql wird beim ersten Start ausgeführt
- `healthcheck`: Prüft ob Postgres bereit ist
- `depends_on` + `condition`: App startet erst wenn DB healthy

**Warum `.env` committed?**
- Die `.env` enthält nur **nicht-sensible Defaults** für lokale Entwicklung
- Ermöglicht `docker compose up` ohne Konfiguration auf frischer Maschine
- **Produktions-Credentials** kommen aus Secret Manager (nicht aus `.env`)

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

**F: Erkläre deinen Algorithmus für die Punktzählung.**
> A: "Ich verwende einen Segment-Merging Ansatz. Statt jeden einzelnen Schritt zu speichern (was bei 10.000 Commands × 100.000 Steps = 1 Milliarde Operationen wäre), speichere ich nur die Liniensegmente. Horizontale Bewegungen werden als (y, x1, x2) gespeichert, vertikale als (x, y1, y2). 
>
> Dann merge ich überlappende Intervalle pro Zeile/Spalte und zähle die Punkte. Am Ende subtrahiere ich Schnittpunkte, die sonst doppelt gezählt würden. Das reduziert den Speicherbedarf von O(Punkte) auf O(Commands) und umgeht das JavaScript Set-Limit von ~16.7 Millionen."

**F: Warum nicht einfach ein Set für jeden Punkt?**
> A: "Das war mein erster Ansatz. Funktioniert super für kleine Inputs. Aber JavaScript Sets haben ein Limit von ~16.7 Millionen Einträgen. Bei der Heavy-Test-Datei mit 10.000 Commands und je ~100.000 Steps crasht das mit 'Set maximum size exceeded'. Der Segment-Ansatz löst das elegant."

**F: Wie funktioniert das Intervall-Merging?**
> A: "Ich sortiere alle Intervalle nach Startpunkt. Dann iteriere ich durch und prüfe: Überlappt das aktuelle Intervall mit dem nächsten? Wenn ja, erweitere ich es. Wenn nein, schließe ich das aktuelle ab und starte ein neues. Am Ende habe ich nicht-überlappende Intervalle und kann die Punkte einfach zählen: `end - start + 1`."

**F: Warum keine Input-Validierung?**
> A: "Die Spezifikation sagt: 'All input is considered well-formed.' Trotzdem prüfe ich die Grundstruktur (Typen, Pflichtfelder) mit einer `validateRequestBody` Funktion. Das verhindert Crashes bei komplett kaputtem Input. Range-Checks (z.B. ob x zwischen -100.000 und 100.000 liegt) mache ich nicht, da die Spec das nicht fordert."

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

**Aktuell implementiert: Segment-Merging mit Sweep-Line**

```
┌────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTIERTER ANSATZ                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Statt jeden Punkt zu speichern, speichern wir SEGMENTE:      │
│                                                                │
│   Bewegung east 100.000 Steps:                                 │
│   ❌ Naiv:   100.000 × visited.add(...)                        │
│   ✅ Smart:  1 × hSegments.push({ y, x1, x2 })                 │
│                                                                │
│   Speicher: O(Commands) statt O(Punkte)                        │
│   Kein Set-Limit Problem!                                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Kernformel:**
```typescript
result = horizontalPoints + verticalPoints - intersections
```

| Komponente | Bedeutung |
|------------|-----------|
| `horizontalPoints` | Alle Punkte auf horizontalen Segmenten (nach Merging) |
| `verticalPoints` | Alle Punkte auf vertikalen Segmenten (nach Merging) |
| `intersections` | Punkte die auf BEIDEN liegen (wurden doppelt gezählt) |

**Warum funktioniert das?**
- Roboter bewegt sich nur horizontal ODER vertikal (nie diagonal)
- Jeder besuchte Punkt liegt auf mindestens einem Segment
- Punkte auf Kreuzungen liegen auf genau zwei Segmenten

**Performance-Ergebnis:**
```
Heavy-Test (10.000 Commands, ~1 Mrd. potentielle Punkte):
- Set-basiert:        ❌ "Set maximum size exceeded" Crash
- Segment-Merging:    ✅ 993.737.501 Punkte in ~1.6 Sekunden
```

---

**Alternative 1: Set<number> mit Integer-Encoding (einfacher, aber limitiert)**
```typescript
const OFFSET = 100_000;
const MULTIPLIER = 2 * OFFSET + 1;

function encodePosition(x: number, y: number): number {
  return (y + OFFSET) * MULTIPLIER + (x + OFFSET);
}

// Jeden Schritt einzeln tracken
for (let i = 0; i < command.steps; i++) {
  x += dx;
  y += dy;
  visited.add(encodePosition(x, y));
}
return visited.size;
```

| Pro | Contra |
|-----|--------|
| Einfach zu verstehen | Set-Limit: ~16.7 Mio Einträge |
| ~4x weniger Speicher als Strings | Crasht bei Heavy-Inputs |
| O(1) add/has | O(Steps) Zeitkomplexität |

---

**Alternative 2: Set<string> (am einfachsten, aber ineffizient)**
```typescript
visited.add(`${x},${y}`);
return visited.size;
```

| Pro | Contra |
|-----|--------|
| Sofort lesbar | ~4x mehr Speicher |
| Keine Mathe nötig | Langsameres String-Hashing |
| | Set-Limit bleibt Problem |

---

**Alternative 3: Sharded Sets (Kompromiss)**
```typescript
// 64 Sets: 64 × 16.7M ≈ 1 Mrd. Kapazität
const SHARD_COUNT = 64;
const shards: Set<number>[] = Array.from({ length: SHARD_COUNT }, () => new Set());

function getShardIndex(x: number, y: number): number {
  return ((x % 8) + 8) % 8 * 8 + ((y % 8) + 8) % 8;
}

// Hinzufügen
shards[getShardIndex(x, y)].add(encodePosition(x, y));

// Zählen
return shards.reduce((sum, shard) => sum + shard.size, 0);
```

| Pro | Contra |
|-----|--------|
| Konzeptionell einfach | Immer noch O(Punkte) Speicher |
| "Teile und herrsche" | Tuning der Shard-Anzahl nötig |
| Umgeht Set-Limit | Langsamer als Segment-Merging |

---

**Entscheidungsmatrix:**

```
                    Einfachheit    Speicher    Max. Punkte    Performance
                    ──────────    ────────    ───────────    ───────────
Set<string>            ★★★★★         ★☆☆☆☆      ~16.7 Mio       ★★☆☆☆
Set<number>            ★★★★☆         ★★★☆☆      ~16.7 Mio       ★★★☆☆
Sharded Sets           ★★★☆☆         ★★☆☆☆      ~1 Mrd.         ★★★☆☆
Segment-Merging        ★★☆☆☆         ★★★★★      Unbegrenzt      ★★★★★
                                                    ↑
                                              IMPLEMENTIERT
```

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

### 11.4 Input Validation

**Aktuell implementiert: Minimale Struktur-Validierung**
```typescript
function validateRequestBody(body: unknown): EnterPathRequestBody {
  if (!isRecord(body)) throw new ValidationError("Request body must be an object");
  if (!isFiniteInteger(body.start?.x)) throw new ValidationError("Invalid 'start' coordinates");
  if (!isDirection(cmd.direction)) throw new ValidationError("Invalid command direction");
  // ... weitere Typ-Prüfungen
  return body as EnterPathRequestBody;
}
```
- Prüft: Objekt-Struktur, primitive Typen, Pflichtfelder
- Prüft NICHT: Wertebereiche (z.B. x ∈ [-100.000, 100.000])
- Per Task-Spec: "All input is considered well-formed"

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
const visited = new Set<number>();
// Jeder Punkt: 8 Bytes Number + Set-Overhead (~24 Bytes)
// 1 Milliarde Punkte × ~32 Bytes = ~32 GB RAM! 💥
// ABER: Mit Set<number> statt Set<string> ~4x besser als String-Variante!
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
      visited.add(encodePosition(x, y));  // Encoding bleibt gleich!
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

### Warum Pino statt console.log?

In der Produktion ist `console.log` ein Anti-Pattern. Hier der direkte Vergleich:

**console.log (❌ für Produktion ungeeignet)**
```typescript
// Unstrukturiert, schwer zu parsen
console.log("Server started on port 5000");
console.log("Request received:", req.method, req.path);
console.log("Error:", err.message);

// Ausgabe:
// Server started on port 5000
// Request received: POST /tibber-developer-test/enter-path
// Error: Connection refused
```

**Pino (✅ production-ready)**
```typescript
// Strukturiertes JSON, maschinenlesbar
logger.info({ port: 5000 }, "server listening");
logger.info({ method: "POST", path: "/enter-path" }, "request received");
logger.error({ err }, "request failed");

// Ausgabe:
// {"level":30,"time":"2026-01-24T21:27:24.263Z","port":5000,"msg":"server listening"}
// {"level":30,"time":"2026-01-24T21:27:24.500Z","method":"POST","path":"/enter-path","msg":"request received"}
// {"level":50,"time":"2026-01-24T21:27:24.600Z","err":{"message":"Connection refused","stack":"..."},"msg":"request failed"}
```

**Vergleich im Detail:**

| Aspekt | console.log | Pino |
|--------|-------------|------|
| **Format** | Unstrukturierter Text | JSON (maschinenlesbar) |
| **Performance** | Synchron, blockiert Event Loop | Asynchron, ~5x schneller |
| **Log Levels** | Keine (alles gleich) | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| **Timestamps** | Manuell hinzufügen | Automatisch (ISO 8601) |
| **Filtering** | Nicht möglich | Nach Level filtern (z.B. nur `warn`+) |
| **Parsing** | Regex-Hacks nötig | `jq`, Elasticsearch, CloudWatch nativ |
| **Context** | Manuell formatieren | Objekte direkt übergeben |
| **Produktion** | ❌ Niemals | ✅ Standard |

**Warum JSON-Logging wichtig ist:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Log Aggregation Pipeline                  │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   App       │───▶│  Filebeat/  │───▶│  Elasticsearch  │  │
│  │ (JSON Logs) │    │  Fluentd    │    │  / CloudWatch   │  │
│  └─────────────┘    └─────────────┘    └────────┬────────┘  │
│                                                  │           │
│                                         ┌────────▼────────┐ │
│                                         │     Kibana /    │ │
│                                         │ CloudWatch Logs │ │
│                                         │   Insights      │ │
│                                         └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

Mit JSON kannst du in Kibana/CloudWatch Logs Insights queries wie diese machen:
```sql
-- Finde alle Requests langsamer als 100ms
fields @timestamp, requestId, durationMs
| filter durationMs > 100
| sort durationMs desc

-- Zähle Fehler nach Status Code
fields statusCode
| filter statusCode >= 400
| stats count(*) by statusCode
```

Mit `console.log`-Text wäre das nur mit fragilen Regex-Patterns möglich.

---

### Was existiert bereits im Projekt?

**1. Logging mit Pino (✓ vorhanden)**

```typescript
// src/logging/logger.ts
import pino from "pino";
export function createLogger(env) {
  return pino({
    level: env.logLevel,        // Filtert nach Level (z.B. nur 'warn' und höher)
    base: undefined,            // Keine automatischen Felder (pid, hostname)
    timestamp: pino.stdTimeFunctions.isoTime,  // ISO 8601 Format
  });
}
```

**2. Request Logging Middleware (✓ vorhanden)**

```typescript
// src/http/requestLogger.ts
export function createRequestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Request ID: Verwende Client-ID oder generiere neue
    const requestId = req.get("X-Request-Id") || crypto.randomUUID();
    const startTime = process.hrtime.bigint();

    // Header für Client-Korrelation setzen
    res.setHeader("X-Request-Id", requestId);

    // Logge wenn Response fertig ist
    res.on("finish", () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - startTime) / 1e4) / 100;

      const logData = {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      };

      // Log Level basierend auf Status Code
      if (res.statusCode >= 500) {
        logger.error(logData, "request completed");  // Server-Fehler
      } else if (res.statusCode >= 400) {
        logger.warn(logData, "request completed");   // Client-Fehler
      } else {
        logger.info(logData, "request completed");   // Erfolg
      }
    });

    next();
  };
}
```

**Beispiel-Output:**
```json
{"level":30,"time":"2026-01-24T21:47:31.693Z","requestId":"c7b1d767-70a3-44ce-84d7-cecd8b1985a0","method":"POST","path":"/tibber-developer-test/enter-path","statusCode":201,"durationMs":122.38,"msg":"request completed"}
```

**Warum Request ID wichtig ist:**

```
┌─────────────────────────────────────────────────────────────┐
│                     Request Correlation                      │
│                                                              │
│  Client sendet:                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ POST /enter-path                                      │   │
│  │ X-Request-Id: client-trace-abc-123                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  Server loggt:                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ {"requestId":"client-trace-abc-123",...}              │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  Server antwortet:                                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ HTTP/1.1 201 Created                                  │   │
│  │ X-Request-Id: client-trace-abc-123                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  → Client kann seine Request ID in Support-Tickets angeben  │
│  → Ops kann in Logs nach genau diesem Request suchen        │
└─────────────────────────────────────────────────────────────┘
```

**3. Health Check (✓ vorhanden)**
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


dese datei und task.md aus repo löschen

alles it .git löschen. git verweise in package.json löschen




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



# Tibber Backend Case Study — Project Explanation & Interview Prep

This document explains the project end-to-end: architecture, algorithms,
dependencies, Docker/DB setup, and testing strategy. It is written to help you
walk confidently through the solution in a technical interview.

---

## 1) Problem Summary (What the service does)

We build a microservice that:

1. Accepts a robot movement path via HTTP:
   - `POST /tibber-developer-test/enter-path`
   - request contains a start coordinate and a list of commands

2. Simulates the robot moving on a grid:
   - The robot cleans every vertex it touches, including the start
   - Commands move the robot step-by-step in one cardinal direction

3. Computes:
   - The number of **unique** positions cleaned

4. Persists the result into PostgreSQL:
   - `executions` table
   - stores insertion timestamp, number of commands, result, and duration

5. Returns the created DB record as JSON.

Constraints:
- Up to 10,000 commands; steps per command up to 99,999.
- Inputs are assumed well-formed (no elaborate validation required).

---

## 2) High-Level Architecture (Clean but not over-engineered)

The code is separated into small layers, each with a single responsibility:

- **Domain** (`src/domain/*`): pure business logic (robot simulation)
- **Application** (`src/application/*`): orchestration (timing + persistence)
- **Infrastructure** (`src/infrastructure/*`): PostgreSQL access via `pg`
- **HTTP** (`src/http/*`): routing and error handling
- **Composition root** (`src/index.ts`): wires everything together

### Why this structure?
- **Testability**: Domain logic can be unit-tested without DB/HTTP.
- **Maintainability**: DB code changes don’t touch domain logic.
- **Production-readiness**: clear boundaries help future extension
  (e.g., add Kafka consumer later) without rewriting core logic.
- **Not over-engineered**: no complex DI frameworks or heavy abstractions.

---

## 3) Folder & File Breakdown (What each file does and why)

### 3.1 `src/domain/` — business rules, framework-independent

- `types.ts`
  - Defines the request and domain types:
    - `Direction`, `Command`, `Start`, `EnterPathRequestBody`, `ExecutionRecord`
  - Keeps type definitions centralized to avoid duplication and inconsistencies.

- `direction.ts`
  - Maps direction strings to movement vectors:
    - north → (0, +1), east → (+1, 0), south → (0, −1), west → (−1, 0)
  - A simple `Record<Direction, Vector>` is more readable than a switch and
    prevents invalid keys at compile time.

- `robotPath.ts`
  - Contains the core algorithm: `countUniqueCleaned(start, commands)`.
  - Implemented as a **pure function**, not a class with mutable fields.
  - Why pure:
    - avoids hidden shared state across requests
    - predictable, deterministic, easy to test

### 3.2 `src/application/` — use case orchestration

- `enterPathService.ts`
  - Implements the single use case:
    - measure calculation time
    - call domain function
    - persist via repository
    - return created record
  - Why separate from HTTP:
    - can be triggered from other adapters later (Kafka, cron, etc.)
    - unit-testable by mocking the repository

### 3.3 `src/infrastructure/` — DB connectivity and SQL

- `db.ts`
  - Creates and verifies a `pg.Pool` using env vars.
  - Keeps DB connection management in one place.
  - Logs connection lifecycle using the app logger.

- `executionsRepo.ts`
  - Repository that inserts an execution into Postgres.
  - Uses raw SQL `INSERT ... RETURNING ...`.
  - Converts returned values to numbers for consistent API output.

### 3.4 `src/http/` — Express integration

- `routes.ts`
  - Registers:
    - `GET /health`
    - `POST /tibber-developer-test/enter-path`
  - Minimal; delegates all logic to the application service.

- `errorHandler.ts`
  - Global error middleware:
    - logs error via `pino`
    - returns `500` with a stable JSON error body

### 3.5 Composition root

- `app.ts`
  - Builds an Express app given:
    - `logger`
    - `enterPathService`
  - This makes it trivial to test routes with `supertest` and a fake service.

- `index.ts`
  - Wires everything together for production:
    - load env
    - create logger
    - connect DB
    - create repo/service/app
    - start listening on port 5000
  - Handles graceful shutdown signals (`SIGINT`, `SIGTERM`).

---

## 4) Algorithm Explanation (Core logic)

### 4.1 Requirement
Count how many **unique** grid vertices are cleaned. Robot cleans:
- the start vertex
- every intermediate vertex on the path, not only where it stops

### 4.2 Approach
Use a `Set` to track visited coordinates.

Pseudo:
1. `(x, y) = start`
2. `visited = Set()`
3. `visited.add("x,y")`
4. for each command:
   - get `(dx, dy)` from direction
   - repeat `steps` times:
     - `x += dx`, `y += dy`
     - `visited.add("x,y")`
5. return `visited.size`

### 4.3 Why `Set`?
- Uniqueness check is average **O(1)**.
- Using an array would make “already visited?” checks O(n) each,
  turning runtime into O(n²) in worst cases.

### 4.4 Complexity
- Time: O(totalSteps) where totalSteps = sum(command.steps)
- Memory: O(uniquePositions)

This is the simplest correct solution. The spec does not require advanced
segment-based counting; implementing that would be “over-engineering”.

### 4.5 Implementation choice: `"x,y"` key
- Simple and readable.
- Works within the given coordinate bounds.
- Alternative is packing into a 64-bit integer for speed; not necessary for this
  case study and less readable.

---

## 5) Persistence & DB Design

### 5.1 Schema

`db/init.sql` creates:

- `executions`:
  - `id BIGSERIAL PRIMARY KEY`
  - `timestamp TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `commands INTEGER NOT NULL`
  - `result BIGINT NOT NULL`
  - `duration DOUBLE PRECISION NOT NULL`

Optional index on timestamp:
- `idx_executions_timestamp_desc`

### 5.2 Why timestamp is DB-generated
The requirement says “timestamp of insertion”. The most correct source of truth
is the database itself. Therefore:
- the insert query omits `timestamp`
- Postgres sets it via `DEFAULT now()`
- we return it via `RETURNING`

### 5.3 Why raw SQL (no ORM)
- Only one table, one insert query.
- Raw SQL is explicit, easy to review, and minimal dependencies.
- ORMs would add complexity and “magic”, which Tibber explicitly discourages.

---

## 6) Duration Measurement

### 6.1 Requirement
Store “duration of the calculation in seconds”.

### 6.2 How it’s done
We measure only the domain calculation, not DB insert or HTTP overhead:

- `process.hrtime.bigint()` provides high-resolution timing.
- durationSeconds = (endNs - startNs) / 1e9.

Why this approach:
- built-in Node API, stable and precise
- avoids issues with system clock changes

---

## 7) HTTP API Behavior

### 7.1 POST endpoint
- Path: `/tibber-developer-test/enter-path`
- Returns: `201 Created`
- Body: the created record:
  - `id`, `timestamp`, `commands`, `result`, `duration`

### 7.2 Health endpoint
- `GET /health` returns `200` with `{ "status": "ok" }`
- Useful for Docker/Kubernetes readiness/liveness in real systems.
- Not required by the spec but a minimal, helpful addition.

### 7.3 Error handling
- Any unhandled error results in:
  - log at error level (structured JSON)
  - response `500` with `{ "error": "Internal Server Error" }`

We keep this minimal because the spec says input is well-formed.

---

## 8) Logging (no console.log)

### 8.1 Why structured logs
In production microservices, logs are often ingested into systems like ELK,
Datadog, or CloudWatch. JSON structured logs:
- are easier to query/filter
- work well across distributed systems

### 8.2 Why `pino`
- commonly used in production Node services
- fast and lightweight
- supports log levels via `LOG_LEVEL`

We intentionally do not add more observability tooling (metrics/tracing) to avoid
over-engineering.

---

## 9) Docker & Docker Compose

### 9.1 Why Docker Compose
The assignment requires:
> “The application should start by simply running `docker compose up`”

Compose provides a reproducible environment with:
- Postgres database
- the app container
- correct networking (app connects to `DB_HOST=postgres`)

### 9.2 DB initialization strategy
Mount `db/init.sql` into Postgres container at:
- `/docker-entrypoint-initdb.d/init.sql`

This is a standard Postgres mechanism: it runs SQL scripts on first initialization.
No manual migration step is needed.

### 9.3 Multi-stage Dockerfile
- **builder stage**: installs dev deps and compiles TypeScript
- **runtime stage**: installs only prod deps (`npm ci --omit=dev`) and runs `dist/`

Why this is production-ready:
- smaller final image
- dev-only dependencies (jest/ts-jest) are not shipped
- reduces security surface area

### 9.4 Node version
Local dev can use Node 22; Docker runtime uses Node 20 LTS for stability.
This is common in real teams.

---

## 10) Testing Strategy

### 10.1 Why tests matter (as Tibber states explicitly)
- The case says: “WE LOVE unit testing!”
- In transaction-heavy domains (energy market), correctness matters.

### 10.2 Unit tests
- Domain tests cover:
  - spec example
  - zero commands
  - overlapping paths
  - negative coordinates
  - all directions
  - 10,000 commands (ensures algorithmic choice is correct)

- Application tests:
  - mock repo
  - verify correct commands count, result, duration

### 10.3 Route-level integration test (without DB)
- Uses `supertest` with a fake `EnterPathService`
- Verifies HTTP contract:
  - status 201
  - response contains required fields

This avoids flaky DB-based tests while still proving routing correctness.

---

## 11) Dependencies — What and Why

### Production
- `express`: minimal HTTP server framework; reduces boilerplate vs built-in `http`.
- `pg`: minimal, mature Postgres driver (Node has no built-in Postgres client).
- `pino`: structured logging, production-friendly, avoids console logging.

### Dev/Test
- `typescript`: compile-time safety; aligns with Tibber stack.
- `@types/*`: type definitions for JS libraries used.
- `jest`: standard test runner, fast feedback.
- `ts-jest`: runs TS tests in Jest without separate build step.
- `supertest`: convenient HTTP tests for Express routes.

We intentionally avoid ORMs/validation frameworks/DI containers.

---

# Technical Interview Prep

## A) Common Questions & Suggested Answers

### 1) “Walk us through your architecture.”
**Answer**
I kept a small layered structure:
- Domain: pure function counting unique cleaned vertices, framework-independent.
- Application: orchestrates use case, measures computation duration, persists via repo.
- Infrastructure: Postgres repository with raw SQL.
- HTTP: Express routes and error middleware.
This separation makes the core logic easy to test and keeps DB/HTTP concerns
isolated.

---

### 2) “How does your algorithm work and what is its complexity?”
**Answer**
I iterate through each step of each command and track visited vertices in a
Set. The result is `Set.size`. Time complexity is O(totalSteps), memory is
O(uniquePositions). Set avoids O(n²) behavior that an array uniqueness check
could introduce.

---

### 3) “Why did you choose `Set` and why store coordinates as strings?”
**Answer**
`Set` provides O(1) average membership and insertion, which is ideal for
uniqueness. Coordinate string keys (`"x,y"`) are readable and sufficient for
the given bounds. Packing into a 64-bit value could be faster but reduces clarity
and isn’t necessary for this case study.

---

### 4) “How do you ensure correctness across multiple requests?”
**Answer**
The domain logic is a pure function with a local Set inside the function, so no
state persists between calls. This prevents cross-request contamination.

---

### 5) “How is duration measured and why that method?”
**Answer**
Duration is measured only around the calculation logic using
`process.hrtime.bigint()` and converted into seconds. It’s a built-in, high
resolution monotonic timer, not affected by system clock changes, and matches
the requirement “duration of calculation”.

---

### 6) “Why is the timestamp generated by the database?”
**Answer**
The requirement says “timestamp of insertion”. The DB is the source of truth for
insert time. Using `DEFAULT now()` avoids clock drift and ensures the timestamp
reflects the actual insert.

---

### 7) “Why raw SQL and no ORM?”
**Answer**
The persistence needs are minimal: one table and a single insert query. Raw SQL
is explicit and easy to review, reduces dependencies, and avoids ORM magic and
migration complexity—aligned with the instruction to avoid over-engineering.

---

### 8) “How would you make this scale / handle high throughput?”
**Answer**
First, I’d ensure correctness. Scaling options:
- Run multiple replicas behind a load balancer (stateless app).
- Tune PG pool size and DB resources.
- Add request rate limiting at gateway if needed.
- For extremely large paths, consider segment-based counting to reduce per-step
  iteration (but that’s beyond the case study).
- Add metrics/tracing (Prometheus/OpenTelemetry) in production.

---

### 9) “What would you improve for production?”
**Answer**
- Input validation and request size limits (even if spec says well-formed).
- Metrics (latency, error rate) and tracing for observability.
- Better error classification (4xx vs 5xx) and consistent error responses.
- Timeouts/retry policies around DB if needed.
- Migrations strategy (Flyway or a minimal migration runner) for evolving schema.

---

### 10) “How does Docker Compose ensure it’s runnable on a clean machine?”
**Answer**
Compose starts Postgres and the app with known versions and environment variables.
The schema is created automatically via `db/init.sql` using Postgres’ standard
`/docker-entrypoint-initdb.d` mechanism. The app waits for Postgres health before
starting, so `docker compose up --build` works without manual setup.

---

### 11) “Why include `/health` if it’s not required?”
**Answer**
It’s a minimal operational endpoint that helps readiness checks in container
environments. It’s low effort and improves operability without adding complexity.

---

### 12) “What about the npm audit/deprecation warnings in dev tooling?”
**Answer**
Those warnings are in transitive devDependencies (test tooling). The production
Docker image installs only production dependencies (`npm ci --omit=dev`), so they
are not shipped to runtime. For a production pipeline, we’d keep dependencies
updated and enforce policies via CI, but for this case it does not affect the
runtime artifact.

---

## B) Drill Questions (short-form)

- What happens when `commands` is empty?  
  Start position is still cleaned → result 1.

- Does the robot clean intermediate steps?  
  Yes, every vertex touched; implemented by iterating each step.

- Where do you measure duration?  
  Around domain calculation only, not DB insert.

- Why `timestamptz` instead of `timestamp`?  
  It avoids timezone ambiguity and is more production-safe.

---

## C) How to present a quick walkthrough (2–3 minutes)

1) “The HTTP route accepts start + commands.”
2) “Application service measures calculation time, calls a pure domain function.”
3) “Domain iterates steps and tracks visited vertices in a Set.”
4) “Repository inserts into Postgres with DB-generated timestamp.”
5) “We return the inserted record.”
6) “We have unit tests for domain and service, plus a route smoke test.”

---

## D) Good closing statement in interview

“I kept the solution minimal but production-like: clear boundaries, pure business
logic, explicit SQL, DB-managed insertion timestamps, high-resolution timing, and
tests that cover correctness and key edge cases. The service is reproducible via
Docker Compose as required.”
