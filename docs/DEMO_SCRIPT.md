# Demonstration walkthrough

Start with `python start.py`. Sign in as operator and open Scenarios.

## Automatic recovery

1. Verify that the demo service responds to health checks. Show its current process
   ID, supervisor restart count and the timestamps on probe receipts.
2. Confirm the process-crash scenario. The runner stops its child process; failed
   probes are recorded before the monitor opens an incident.
3. Show the analysis source. If it says demo fallback, explain that this is local
   rule-based analysis, not a successful Gemini call.
4. Inspect the policy verdict and the recorded runbook execution. The supervisor
   restarts the fixed child process; its process ID can change.
5. Wait for independent verification. Show the actual successful probe events and
   measured recovery time rather than quoting a predetermined duration.

## Human review

1. Reset, wait for healthy checks, and confirm the degraded-response scenario.
2. Show the HTTP 500 probe receipts and incident analysis.
3. Explain that the policy blocks automatic recovery. Sign out and sign in as admin
   only if demonstrating the guarded approval controls.
4. Inspect the complete event messages and JSON payloads in Audit trail. Sequence
   numbers are local to each incident; timestamps and incident IDs distinguish runs.

Finish with the architecture, private runner boundary, known limits and the separate
Gemini Enterprise integration plan. Do not describe unimplemented connectors or
local notification records as working integrations.
