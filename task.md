# Tibber Technical Case: Robot Cleaner Microservice

## 1. Context & Environment
The Tibber platform consists of a swarm of microservices running as Docker containers. 
- **Primary Platforms:** .NET, Node JS, and Python.
- **Data Storage:** 
    - PostgreSQL (relational/document storage)
    - Amazon S3 (blob storage)

## 2. The Task
Create a new microservice that simulates a robot moving in an office space and cleaning the places it visits. 

### Core Requirements:
- **Simulation:** The robot starts at specific coordinates and follows move commands.
- **Unique Cleaning:** The robot reports the total number of unique places cleaned.
- **Data Persistence:** Results must be stored in a PostgreSQL database.
- **API:** The service must listen to the HTTP protocol on **port 5000**.
- **Output:** Return the created record in JSON format.

---

## 3. API Specification

### Endpoint
- **Method:** `POST`
- **Path:** `/tibber-developer-test/enter-path`

### Request Body Example
```json
{
  "start": {
    "x": 10,
    "y": 22
  },
  "commands": [
    {
      "direction": "east",
      "steps": 2
    },
    {
      "direction": "north",
      "steps": 1
    }
  ]
}
```

### Input Criteria
- `0 ≤ number of commands elements ≤ 10000`
- `-100,000 ≤ x ≤ 100,000, x ∈ Z`
- `-100,000 ≤ y ≤ 100,000, y ∈ Z`
- `direction ∈ {north, east, south, west}`
- `0 < steps < 100,000, steps ∈ Z`

---

## 4. Data Storage
The result must be stored in a table named `executions` with the following schema/fields:

| Field | Description |
| :--- | :--- |
| **ID** | Unique identifier for the execution |
| **Timestamp** | Time of insertion |
| **Commands** | Number of command elements processed |
| **Result** | Number of unique places cleaned |
| **Duration** | Calculation duration in seconds (e.g., 0.000123) |

---

## 5. Technical Rules & Notes
- **Grid Movement:** The office is a grid; the robot moves only on vertices.
- **Cleaning Logic:** The robot cleans every vertex it touches, including the start and every step along the path (not just the stop points).
- **Validation:** All input is considered well-formed and syntactically correct; no elaborate validation is required.
- **Bounds:** The robot will never be sent outside the office bounds.
- **Config:** Database connection must be configurable via **environment variables**.
- **Dependencies:** Use only open-source dependencies.

---

## 6. Deliverables & Assessment

### Deliverables
- Source code with clear structure.
- `Dockerfile` and `docker-compose.yaml`.
- The application must start via `docker compose up` from the root.
- Unit tests.

### Assessment Criteria
- **Testing:** High value is placed on unit tests.
- **Runnability:** Must run on a clean machine (not just the developer's local OS).
- **Simplicity:** Avoid over-engineering. "Clean code is happy code."
- **Standard Library:** Use built-in libraries where possible. Justify any extra packages in a README.

---

## 7. Submission
- Pack the project into a **ZIP file**.
- **Crucial:** Remove any `.git` files to avoid bias during assessment.
- Send the ZIP to your Recruiter.
