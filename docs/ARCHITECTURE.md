# Architecture

Rebound has four application processes and a database.

1. The sandbox supervisor owns a fixed child HTTP process. Its control API requires
   an internal token. The child can run normally, return a simulated application
   fault, or be stopped to demonstrate connection failure.
2. The monitor worker probes the child and saves every observation. Repeated
   failures open an incident. Repeated successes verify recovery.
3. The API serves incidents, observations, audit history, settings and authenticated
   controls. SQLite is the native default; Compose uses PostgreSQL.
4. The Next.js app proxies requests to the API and displays recorded data. It polls
   as a fallback to server-sent events. The worker runs separately from the API,
   so polling remains necessary even when no broadcast arrives in the API process.

## Incident flow

A failure becomes an incident after the configured number of failed probes. The
analyzer returns `AIAnalysisResult`; the independent policy engine checks the
symptom, target, runbook allowlist, attempt count and cooldown. Only the supervisor
can restart the predefined child process. Successful execution moves to verification,
not resolution. Healthy probes complete verification; failures can escalate.

Unknown faults require human review. The Gemini API and the local fallback share
an output schema, but provider labels distinguish which implementation produced a
result. `fallback_reason` explains why a live provider was not used.

## Persistent records

- `services` and `health_observations`: monitor state and probe evidence.
- `incidents` and `incident_events`: workflow state and incident-scoped sequence.
- `ai_analyses`: validated results, actual provider and fallback reason.
- `runbook_executions`: execution state, idempotency keys and approval references.
- `users`, `settings`, `notifications`: accounts, configuration and local notices.

The dashboard returns a bounded sample of recent checks. Its reliability percentage
is a sample success rate, not a time-weighted uptime guarantee. Audit history uses
cursor pagination to preserve events with identical timestamps.

## Boundaries

The native supervisor binds to localhost. In Compose it binds within an internal
network, with no published runner port and no host Docker socket. The worker has
outbound network access for Gemini requests. The web app and API are separate
containers; API proxying is configured at frontend build time.
