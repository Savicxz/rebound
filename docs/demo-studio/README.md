# Demo Studio: judge walkthrough and evidence

The Studio pairs a simulated student workspace with Rebound's independent monitor.
Student buttons call `/api/v1/demo/workflow-check`, which sends a real HTTP request
to the isolated child service. Those requests never increment monitor counters or
resolve an incident. Sample course content is illustrative, not a real school integration.

## First 90 seconds

Use the learning portal for the first demonstration. Times below are presentation
guidance, not a promised execution duration or a simulated progress schedule.

1. **0–10 seconds:** Run `python start.py`, open the dashboard and click **Start local
   demo**. Successful local sign-in opens **Demo Studio** automatically. Explain:
   “School services fail; blindly restarting them can make things worse.”
2. **10–20 seconds:** The portal is preselected. Click **Run demonstration**, review
   the fault description and **Confirm scenario**. Rebound captures a real student
   baseline request, checks the backend baseline and injects a sandbox process crash.
3. **20–60 seconds:** Watch the student request fail beside the monitor. Point out
   repeated failed probes, the recorded analysis provider, policy and the single
   allowlisted restart. No timed animation advances the incident. If the worker or
   backend is unavailable, stop and use the error/retry guidance rather than claim
   an outcome. Default monitoring is every five seconds; credentials/network latency
   can change execution time.
4. **60–80 seconds:** Show the successful independent request and **Portal restored.
   Recovery verified.** Compare observed HTTP status, latency and PID. Recovery time
   is measured **from incident detection to verified resolution**, not from the
   first failed student request. A separate successful student request is captured
   after recorded resolution; it is not substituted for monitor verification.
5. **80–90 seconds:** Click **Print incident summary** or **Download evidence JSON**.
   Explain the synthetic-workload disclosure and the actual provider label. The print
   button captures a fixed snapshot; use the browser's print dialog to print or save PDF.

## Two follow-up stories

- **Database contention:** Reset, or choose **Choose another demo**, expand the
  curated choices, select registration and run the selected demo. The workload
  returns HTTP 500. Rebound records a policy safety stop and human review. No restart,
  successful verification or recovery time is invented. A suggested support handoff
  does not create a real ticket or send a message.
- **Attendance queue replay:** Select attendance. The workload returns HTTP 429 with
  twelve synthetic queued records. The bounded replay processes them; a subsequent
  student request reports zero pending and twelve processed. The process PID and
  restart counter remain unchanged. Independent probes still verify recovery.

**Replay this demo** confirms a reset and creates a distinct run. **Reset sandbox**
closes an open incident administratively and retains incident history; reset is not
verified recovery. Existing non-curated runs must be reset before a Studio story.
The broader backend scenario catalog remains available through its existing API.

## Screenshots from live end-to-end tests

These are real isolated test runs, including their actual timestamps, PIDs and
latencies. Tests use a two-second health interval to keep CI bounded; normal startup
retains the five-second default. The test environment has no Gemini key, so the
screenshots truthfully show deterministic fallback. They are examples, not promised timings.

- [Initial Studio](screenshots/studio-ready.png)
- [Verified portal recovery](screenshots/studio-crash-verified.png)
- [Database safety stop in dark mode](screenshots/studio-human-review-dark.png)
- [Attendance replay on a mobile viewport](screenshots/studio-attendance-mobile.png)
- [Disconnected request path](screenshots/studio-disconnected.png)
- [Printable evidence snapshot](screenshots/incident-print-summary.png)

## Repeatable tests

After installing normal Python/Node dependencies:

```powershell
cd apps/web
npx playwright install chromium
npm run test:e2e
```

Playwright starts a separate API, worker, supervisor, child workload and Next server.
It uses ports **3101, 8101, 5107 and 5108**, a temporary SQLite database under
`.logs/e2e`, ephemeral test credentials, and no external AI calls. It refuses to reuse
an occupied test server. `REBOUND_TEST_PYTHON` can select an installed Python with
the project requirements. Logs are written to `.logs/e2e`; failures retain traces
and screenshots under the ignored `apps/web/test-results` directory.

Coverage includes local onboarding, portal crash and restart, real HTTP failure and
success receipts, independent verification, JSON export, printable snapshot, replay,
database human review without execution, queue replay with PID preservation, mobile
width, reduced motion, dialog cancellation and browser-to-backend disconnection/retry.
Connection loss is injected at the browser request boundary; it does not fake a
backend incident or physically stop a production service. Print-dialog invocation
is stubbed in the browser test; print-media rendering and report content are checked.

## Honest limits

- One synthetic child workload, three curated stories, no real student records,
  physical equipment, school network or production connectors.
- “Gemini API” is shown only when a recorded analysis actually used that provider.
  Keyless tests show fallback; live Gemini and Enterprise execution are not tested here.
- Probe history is bounded. Missing before/failure/after observations are labelled
  **Not observed**. Runtime observations can be newer than the incident.
- Independent request receipts are held in browser memory. Reloading retains server
  incidents, but cannot recreate missing student-request history.
- Chromium desktop/mobile emulation and print media are tested. Physical touch
  devices, other browser engines and native printer/PDF dialogs remain manual checks.
