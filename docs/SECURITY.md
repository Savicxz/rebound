# Security boundaries

Rebound is a synthetic incident-recovery demonstration, not a hardened production
operations platform.

## Implemented controls

- Recovery is limited to two fixed runbooks on one predefined demo child process:
  restart it or replay its bounded synthetic attendance queue.
- The runner requires an internal token and binds to localhost in native mode.
  Compose places it on an internal network without publishing its ports.
- Operator and administrator permissions are checked server-side on mutations.
- Accounts use bcrypt password hashes and signed expiring session tokens.
- The browser requires an explicit session; passwords are not embedded in its bundle.
- Session cookies are HttpOnly and SameSite=Lax; non-demo environments use Secure.
- Non-demo configuration rejects built-in secrets and short replacement values.
- One automatic recovery attempt per incident and a cooldown limit repeated actions.
- Recovery must be independently verified with successful probes.
- Sensitive log patterns are redacted before analysis. Regex redaction is not a
  guarantee that arbitrary personal data is removed; only synthetic data is intended.

## Access model

Unauthenticated users can read synthetic telemetry, incident history and settings.
Operators can trigger and reset demo faults. Administrators can also approve and
reject guarded runbooks. Internal runner access uses a separate token.

The native local demo has a one-click session using the seeded demo administrator.
It requires `ENVIRONMENT=demo`, `LOCAL_DEMO_ACCESS=true`, a loopback client and local
browser origin. Nonlocal forwarded addresses and hosts are rejected. Turn it off for
a shared deployment. It does not configure or require Google Cloud IAM roles.

Read-only access is intentional for local judging. Review it before publishing any
non-synthetic data. Default demo credentials are public examples and must be replaced
before exposing a shared environment. Existing seeded passwords do not change when
`.env` changes.

## Limitations

Audit records are stored in the application database. They are not signed or
cryptographically immutable. Notifications are database records; no email delivery
is implemented. The built-in service is synthetic. There is no production service
integration or completed Gemini Enterprise connector.

A public deployment also needs a trusted HTTPS edge, access restrictions appropriate
to its users, credential management, dependency review, monitoring, backups and
resource limits. Creating a repository does not deploy the application.
