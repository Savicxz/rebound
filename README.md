# Rebound — Safe Recovery for Campus Services

**Rebound** is a campus IT automation prototype that detects service failures, records evidence, evaluates a fixed safety policy, performs narrowly authorized recovery actions, and independently verifies the result.

**Live HTTPS demo:** https://rebound-production-1974d3f6.up.railway.app  
**Repository:** https://github.com/Savicxz/rebound  
**Project:** APU Cloud Innovation Hackathon 2026 — Intelligent Automation & Digital Transformation

> **Prototype boundary:** All workloads and attendance records are synthetic. Rebound is not connected to a real university, student information system, or production service.

## Evidence-grounded AI investigation

Campus IT teams repeat the same work: inspect a failure, decide whether a known intervention is safe, and check whether it worked. Rebound demonstrates that loop on synthetic services. Students are potential beneficiaries of service availability; no student impact, time saving, or financial return has been measured.

When configured, the existing Google GenAI SDK checks `GEMINI_MODEL` availability, offers Gemini two incident-scoped **read-only** tools (recorded probes and incident event history), validates its structured recommendation, then hands it to the unchanged deterministic policy. Gemini cannot execute a runbook. Unknown actions, invented evidence, contradictory current observations, or invalid responses require review. Provider outages use the clearly labelled deterministic fallback.

The versioned prompt is in `services/api/investigation.py`. Evidence and tool results are untrusted data. Actual validated requests, results, evidence references, occurrence times and model/provider details are retained in the existing analysis JSON and incident events. Trace events are buffered until analysis completes, so the console presents recorded activity rather than live token streaming. No private model reasoning is exported. Older incident JSON remains readable; no database migration is required.

Limits: one concurrent Gemini investigation and three starts per rolling minute **per monitor process**; two diagnostic rounds, two tools per round, at most three generation calls; SDK retries disabled; 512 output tokens per diagnostic call and 1,536 for assessment; bounded evidence payloads and a 12,000 reported-token stop before another call. A 429 starts a 60-second cooldown. The existing analysis deadline remains the outer limit. Run one monitor worker: this process-local quota is not a distributed rate limiter. Existing atomic incident claims prevent duplicate analysis/recovery for an incident. Failed analysis never implies that a tool ran or recovery succeeded.

Set credentials only in server-side Railway variables, never the browser. Local validation had no configured key: mocked provider tests establish orchestration behavior, **not live Gemini availability**. Verify a genuine configured-provider run before claiming Gemini in a presentation. A successful run must show `gemini_api`, completed diagnostic evidence if requested, and recorded policy/verification events. Gemini may decide no extra tools are needed; do not add fictional calls.

[Judge narration, capture instructions and rubric evidence](docs/demo-studio/README.md#judging-evidence-and-120-second-capture).

The default model is `gemini-3.5-flash-lite`, overridable with worker-side `GEMINI_MODEL`. Google restricts access to deprecated `gemini-2.5-flash` for newer users; a successful metadata lookup does not prove generation access. See [Google's deprecation guidance](https://aistudio.google.com/docs/deprecations#gemini-2.5-flash-models). Manual tool responses preserve provider call IDs and use user-role turns; SDK wire-format regression tests use mocked HTTP and are not live-provider evidence. Fallback diagnostics expose only HTTP status and controlled request-stage names, never raw provider responses.

### Optional live-provider check

```sh
python -m pytest tests/integration/test_gemini_live.py --live-gemini -q
```

Configure `GEMINI_API_KEY` securely in the process environment beforehand; `GEMINI_MODEL` remains configurable. Do not paste credentials into this command. The test skips without explicit opt-in or when the environment key is missing. Normal CI stays keyless and uses mocked provider responses. An opted-in provider error **fails** the test rather than treating fallback as success. It uses synthetic evidence and the isolated test database and never runs recovery. Skipped or mocked tests do not verify live Gemini integration.

## Open the hosted demo

1. Visit **[Rebound on Railway](https://rebound-production-1974d3f6.up.railway.app)**.
2. Click **Try hosted demo**. No password is needed for the synthetic judging experience.
3. Rebound opens **Demo Studio** with a restricted **operator** session, where judges can run the three isolated scenarios.

**For project administrators:** Expand **Administrator or existing account sign-in** and use your private credentials (administrator username: `admin`). Administrator passwords are **not** published in this repository or displayed on the website.

**Access boundaries:** Public judge access is opt-in on the hosted API (`PUBLIC_JUDGE_ACCESS=true` and `PUBLIC_JUDGE_ORIGIN=https://rebound-production-1974d3f6.up.railway.app`). The one-click judge account has only `OPERATOR` permissions, not `ADMIN`; backend policy continues to control every recovery action. Admission to new sessions is rate-limited. This is a shared synthetic demo: multiple visitors can affect the same simulated workload and reset it. No real university data is connected.

The **Start local demo** button remains available on `localhost` only. **Never commit real passwords, tokens, or `.env` files.** Account passwords are seeded when first created; changing the `ADMIN_PASSWORD` variable alone does **not** rotate an existing account.

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
