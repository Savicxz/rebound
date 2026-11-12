# Rebound

Service monitoring, incident investigation and bounded recovery for a synthetic HTTP service.

Rebound records health checks, opens incidents after repeated failures, analyses
sanitized evidence with Gemini or a labelled local fallback, evaluates a fixed
recovery policy, and verifies that a restarted service is healthy.

This project operates on its own demo process. It is not connected to production
systems. Charts and incident timings come from recorded probes and events.

## Start locally

Requirements: Python 3.10+ and Node.js 18+ with npm. Docker is optional.

```powershell
git clone https://github.com/Savicxz/rebound.git
cd rebound
python start.py
```

The launcher creates `.venv` and `.env` when missing, installs missing dependencies,
checks ports, starts the sandbox, API, worker and dashboard, and opens
http://localhost:3000. Keep the terminal open; Ctrl+C stops its child processes.
Use `python start.py --check` for a read-only prerequisite check, or
`python start.py --no-browser` to skip opening a browser.

Service logs are written to `.logs/` and overwritten on the next launch.
Stop any manually started services before using the launcher.

## Demo access

Click **Start local demo** to use one session on localhost. No Google Cloud account
or IAM role setup is required. Sign-in opens the **Demo Studio**, with a student
service panel beside the independent monitoring and recovery evidence. Follow the
[90-second judge walkthrough](docs/demo-studio/README.md) for curated scenarios,
printable evidence, screenshots and repeatable live browser tests.

The button is disabled server-side outside demo mode,
for remote requests, or when `LOCAL_DEMO_ACCESS=false`. Container and remote demos
can use **Account access for other deployments**. Read-only service data is public.
The defaults below are for local demonstrations only:

| Account | Password | Permissions |
| --- | --- | --- |
| operator | OperatorPassword2026! | Trigger and reset demo faults |
| admin | AdminPassword2026! | Also approve or reject guarded recovery |

Change passwords in `.env` **before the first startup** when sharing access.
Accounts are seeded once; changing the environment does not change an existing
account's password. Use a new demo database when setting up a separate environment.
Do not commit `.env`, database files or credentials.

## Try the Demo Studio

1. Click **Start local demo** to open **Demo Studio**. Confirm the service is healthy.
2. Run the default attendance story: twelve synthetic records enter a stalled queue.
   Rebound permits a bounded replay; the response reports zero pending and twelve processed.
   Two successful independent health checks verify recovery without restarting the process.
3. Review the plain-language outcome. Expand **Advanced technical evidence** for
   process observations, probe receipts, analysis source and the event journal.
   A successful action alone does not prove recovery.
4. Compare student-request receipts and before/failure/after observations. Print the
   human-readable incident summary or download the JSON evidence snapshot.
5. Reset the sandbox, wait for healthy checks, then choose another workflow.
   Reset closes open incidents without marking them as verified recoveries.
6. Inspect complete messages and payloads in **Audit trail**. Use **Load older
   events** to inspect earlier records.

The Studio curates learning-portal crash, registration database contention and
attendance queue replay. Expand **Choose a different story** to select a scenario.
The complete backend catalog below remains available through the existing API;
additional infrastructure scenarios are not part of the focused judge workspace.

| School workflow | Actual injected fault | Response |
| --- | --- | --- |
| Learning portal | Stopped child process | One restart and independent verification |
| Course registration | HTTP 500 / synthetic pool fault | Human investigation |
| Student sign-in | HTTP 503 / synthetic identity dependency failure | Human investigation |
| Assignment submission | HTTP 507 / simulated upload quota | Capacity review; no file deletion |
| Attendance synchronisation | HTTP 429 / twelve synthetic queued records | Bounded queue replay, same process, then verification |
| Online assessment | Actual 800 ms delay with HTTP 200 | Latency-limit detection and human investigation |

All profiles use one isolated workload rather than connected school services.
Additional infrastructure profiles cover attendance check-in unavailability,
mesh backhaul loss, exam Wi-Fi congestion, intranet DNS failure, missing projector
input, and auditorium amplifier protection. These return synthetic controller
signals through the sandbox API. They do not disconnect Wi-Fi, change host DNS,
measure real packet loss, or control physical AV equipment. Each identifies a
suggested support team and requires human investigation; no ticket is sent.
Potential impact text explains the school context; it does not claim measured
student disruption. The queue is in memory and contains no personal data. Its replay
is a demonstration, not a durable production messaging system. Slow checks exceed
`HEALTH_LATENCY_LIMIT_MS` (500 ms by default); client setup time is excluded.

The header switches between light and dark appearance and remembers the preference.
Runtime settings are read-only and report the server configuration.

## AI providers

Set `GEMINI_API_KEY` in `.env` to enable the Gemini API. Without a key, or after a
failed request, results are labelled `demo_fallback`. Configured credentials are
not evidence of a working connection; runtime settings show the latest recorded
provider and analysis time. Gemini can recommend an action but cannot execute it.

Gemini Enterprise is a reserved interface, not a completed integration. See
[the integration plan](docs/ENTERPRISE_INTEGRATION.md).

## Verify

With dependencies installed by the launcher:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/ -q
cd apps/web
npm run check
npm run build
```

The tests use separate local ports and a temporary database. They do not require a
Gemini key. `verify_scenarios.py` is an additional manual checker for a running stack.

## Containers (optional)

```powershell
docker compose --env-file .env -f infra/docker-compose.yml up --build
```

The web app and API bind to localhost ports 3000 and 8000. PostgreSQL and the
supervisor are internal containers; the worker has outbound access for Gemini.
The frontend proxies API requests to the API container. Docker deployment has to
be validated on the target machine; it is not required for the native launcher.

## Sharing and deployment

The source can be hosted on GitHub for free. A hosted app is separate from the
repository; GitHub Pages cannot run this Python backend and worker.

A temporary HTTPS tunnel can expose the local dashboard for a demonstration, but
it requires the laptop and stack to stay running. Do not share a tunnel using
unchanged demo credentials. Keep supervisor ports private. Use a VM for an
unattended deployment and review authentication, TLS, database retention and costs.
Non-demo environments reject the built-in secrets and use secure session cookies.

See [security boundaries](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md),
[demo instructions](docs/DEMO_SCRIPT.md), and [submission checklist](docs/SUBMISSION_GUIDE.md).

## Source layout

- `services/api/`: authentication, dashboard, incident records, policy and analysis.
- `services/monitor_worker/`: probes, incident detection and recovery verification.
- `services/sandbox_runner/`: private process supervisor and synthetic workload.
- `apps/web/`: Next.js interface, charts, audit inspection and demo evidence.
- `tests/`: policy, API, process lifecycle and launcher checks.
- `infra/`: optional container configuration.

Audit records are application event history, not a cryptographically tamper-proof
log. Notifications are local demo records, not proof of email delivery.


For a prebuilt web demo, run `npm run build:production` in `apps/web`, then `python start.py --production-web` from the repository root. This uses an isolated standalone build; `python start.py` continues to start the development server. See [performance and reliability notes](docs/performance/README.md) for measurements, event-delivery semantics and limits.
