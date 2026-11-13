# Rebound — Safe Recovery for Campus Services

**Rebound** is a campus IT automation prototype that detects service failures, records evidence, evaluates a fixed safety policy, performs narrowly authorized recovery actions, and independently verifies the result.

**Live HTTPS demo:** https://rebound-production-1974d3f6.up.railway.app  
**Repository:** https://github.com/Savicxz/rebound  
**Project:** APU Cloud Innovation Hackathon 2026 — Intelligent Automation & Digital Transformation

> **Prototype boundary:** All workloads and attendance records are synthetic. Rebound is not connected to a real university, student information system, or production service.

## Open the hosted demo

1. Visit **[Rebound on Railway](https://rebound-production-1974d3f6.up.railway.app)**.
2. Expand **Account access for other deployments**.
3. Enter the credentials supplied by the project owner:
   - **Administrator username:** `admin`
   - **Administrator password:** provided privately — **not published in this public repository**
4. Click **Sign in**, then open **Demo Studio**.

**Important:** The **Start local demo** button is for `localhost` only and deliberately cannot sign users in on the hosted Railway deployment. On the hosted website, use the account form instead.

The hosted administrator credential is configured for the **api** service in Railway (`ADMIN_PASSWORD`). For judges, share credentials through a private channel, or create a dedicated limited-access operator account. **Never commit real passwords, tokens, or `.env` files.** Account passwords are hashed and seeded when first created: changing `ADMIN_PASSWORD` afterward does **not** rotate the existing account automatically.

## What to demonstrate

Rebound provides three focused scenarios in **Demo Studio**.

| Scenario | Recorded problem | Safe outcome |
| --- | --- | --- |
| **Attendance synchronization** (recommended) | Synthetic attendance queue stalls with 12 pending records | Approved bounded replay; observe 12 processed, 0 remaining, followed by independent health verification |
| **Course registration** | Synthetic database contention produces HTTP 500 errors | No approved automatic remedy; stop for human investigation |
| **Learning portal** | Isolated demo child process stops | One predefined restart, followed by independent health verification |

### Attendance demonstration

1. Sign in and select **Attendance records stop syncing** (the default).
2. Click **Run demonstration** and confirm the scenario.
3. Observe the actual failure detection, recorded analysis and its provider, deterministic policy decision, recovery action, and verification.
4. Check the result: **12 pending at failure → 12 processed → 0 remaining** in the recorded successful scenario. Values shown in the application come from actual demo observations, not hardcoded display data.
5. Expand **Technical details** to inspect incident events, probe observations, execution receipts, and evidence exports.

The monitor uses repeated failed checks to open an incident and requires independent successful checks to verify recovery. A successful action by itself is **not** proof of recovery. Wait for the actual outcome rather than resetting a pending run to imply success.

See the [90-second presentation script and screenshots](docs/demo-studio/README.md).

## How Rebound works

```text
Synthetic service failure
         ↓
Independent monitoring and incident detection
         ↓
Recorded evidence analysis (Gemini API if available, otherwise labelled fallback)
         ↓
Deterministic safety-policy decision
         ↓
Authorized recovery action — or human review
         ↓
Independent verification and recorded incident outcome
```

**Safety first:** Analysis can recommend a recovery action, but it cannot authorize or execute arbitrary commands. The backend allows only defined actions for the isolated demo process. Unsupported faults are not automatically repaired.

**AI provenance:** Without a functioning Gemini API key, analyses are labelled **deterministic demo fallback**; that is not a live Gemini call. Gemini Enterprise integration is not implemented. Do not describe the fallback as live AI.

## Hosted architecture

Rebound runs on **Railway**, independently of a developer laptop, with HTTPS provided by Railway.

| Railway service | Technology | Access |
| --- | --- | --- |
| `rebound` | Next.js / React website | Public HTTPS |
| `api` | Python FastAPI, authentication, policy and incident records | Private |
| `monitor-worker` | Continuous health checks and verification | Private |
| `sandbox-runner` | Isolated demo process and fixed recovery actions | Private |
| `Postgres` | Persistent incident and configuration database | Private |

The frontend forwards `/api/*` requests to the private API. Runner control ports and the database are not publicly exposed. The hosted demonstration requires account sign-in; local one-click access is disabled remotely.

Railway hosting is usage-billed; service availability depends on the project remaining active. The live domain is a stable project hostname, not a temporary localhost tunnel.

## Run locally (for development)

Requirements: Python 3.10+, Node.js 18+, and npm.

```powershell
git clone https://github.com/Savicxz/rebound.git
cd rebound
python start.py
```

The launcher installs missing dependencies, creates a local environment if needed, starts all application processes, and opens `http://localhost:3000`. The **Start local demo** button works only for an eligible localhost session. To check prerequisites without starting services, use `python start.py --check`.

For a prebuilt frontend:

```powershell
cd apps/web
npm ci
npm run build:production
cd ../..
python start.py --production-web
```

The local Docker Compose configuration is in `infra/docker-compose.yml`. Railway uses the four Dockerfiles under `infra/` and a separate managed PostgreSQL service; do not assume the local Compose defaults are safe for public hosting.

## Tests and documentation

```powershell
# From the repository root
.\.venv\Scripts\python.exe -m pytest tests/ -q

# Then from apps/web
npm run check
npm run format:check
npm run test:e2e
npm run build
```

The last recorded prototype validation passed **58 Python tests** and **9 Playwright tests**, including three consecutive attendance recoveries. These test results are not a substitute for testing the live Railway environment.

- [Demo walkthrough and evidence](docs/demo-studio/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security boundaries and limitations](docs/SECURITY.md)
- [Submission guide](docs/SUBMISSION_GUIDE.md)
- [Gemini Enterprise integration plan (not implemented)](docs/ENTERPRISE_INTEGRATION.md)

**Limitations:** Attendance records are synthetic and queued in memory; there is no university integration, production ticketing, email delivery, or durable attendance synchronization guarantee. Incident logs are application records, not cryptographically immutable audit trails.
