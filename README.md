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

## Demo accounts

Sign in through the form to control the sandbox. Read-only service data is available
without signing in. The defaults below are for local demonstrations only:

| Account | Password | Permissions |
| --- | --- | --- |
| operator | OperatorPassword2026! | Trigger and reset demo faults |
| admin | AdminPassword2026! | Also approve or reject guarded recovery |

Change passwords in `.env` **before the first startup** when sharing access.
Accounts are seeded once; changing the environment does not change an existing
account's password. Use a new demo database when setting up a separate environment.
Do not commit `.env`, database files or credentials.

## Try the two scenarios

1. Open **Scenarios** and confirm the service is healthy.
2. Simulate a service crash. Three failed checks normally open an incident; policy
   may permit one restart. Resolution requires two successful health checks.
3. Review the process PID, restart count, probe receipts, analysis source and event
   journal. A successful restart alone does not prove recovery.
4. Reset the sandbox, wait for healthy checks, then simulate a degraded response.
   HTTP 500 or uncertain evidence requires administrator review.
5. Inspect complete messages and payloads in **Audit trail**. Use **Load older
   events** to inspect earlier records.

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
