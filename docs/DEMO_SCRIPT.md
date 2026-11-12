# Demonstration walkthrough

Start with `python start.py`. Click **Start local demo** and open Scenarios.
No cloud IAM roles are needed. Each school profile shares one isolated workload.

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

1. Reset, wait for healthy checks, and confirm course-registration database contention.
2. Show the HTTP 500 probe receipts and incident analysis.
3. Explain that the policy blocks automatic recovery. The local demo session already
   includes review controls, so account switching is unnecessary.
4. Inspect the complete event messages and JSON payloads in Audit trail. Sequence
   numbers are local to each incident; timestamps and incident IDs distinguish runs.

## Attendance workflow and early degradation

1. Reset and run attendance synchronisation. Twelve synthetic records enter the
   queue and HTTP 429 probes open an incident. The replay runbook processes the queue.
2. Show the runbook receipt with processed and remaining counts. The PID and restart
   count stay unchanged; two healthy checks verify recovery.
3. Reset and run online assessment. HTTP 200 is still returned, but the measured
   delay exceeds 500 ms. The incident requires investigation, not a blind restart.
4. Sign-in dependency and assignment quota profiles demonstrate HTTP 503 and 507.
   Describe the potential school impact without claiming real users are affected.
5. Download evidence JSON for a completed incident. Reset closes review incidents
   administratively; it does not count them as verified recovery.

## Network and AV handoff

Select mesh uplink loss, exam Wi-Fi congestion, intranet DNS, projector input,
auditorium audio, or attendance check-in unavailability. Read the modelled signal
path, inject the fault, then use **Send test request** to retrieve the synthetic
controller response. The monitor opens an incident and stops for human review.
Show the suggested responsible team and next steps. No ticket is actually sent.
The network and equipment signals are simulated; the HTTP request and incident
records are real. No Wi-Fi adapter, DNS settings, projector or amplifier is changed.

Finish with the architecture, private runner boundary, known limits and the separate
Gemini Enterprise integration plan. Do not describe unimplemented connectors or
local notification records as working integrations.
