# Realtime and monitoring optimization

Base: API measurements started against `main` at `d8c1d4f`. While implementation was in progress, PR #3 merged; this branch incorporates `main` at `1c27931`. The browser comparison was rerun against that matching UI/1366 ? 768 viewport. PR #3 contains no backend changes, so the API baseline remains equivalent.

## What changed

- A transactional database watermark replaces process-local worker broadcasts. SQLAlchemy tracks flushed changes and increments the shared row in the same transaction as the evidence. Rollbacks never publish a new revision. One API relay reads the watermark four times per second only while clients subscribe; a one-slot subscriber queue coalesces changes. No Redis or other service is required.
- SSE carries committed **snapshot invalidations**, with revision IDs. It is not a replay log of every intermediate transition. On every connection the server sends the current committed revision, and the browser reconciles authoritative state. Incident histories remain available through the existing detail/audit endpoints. `Cache-Control: no-transform` prevents the Next.js proxy from gzip-buffering SSE messages.
- Dashboard/incident refreshes are single-flight with one trailing reconciliation. A 100 ms event-burst coalescer, revision deduplication, abort-on-unmount, generation checks, and unchanged-snapshot reuse avoid competing/stale responses. Dashboard polling is every five seconds when SSE fails and reconciles every fifteen seconds when the stream is healthy. Incident lists load only when viewed.
- The daemon owns a bounded triage pool (default two; configurable 1–8), separate sessions, atomic incident claims and stable automatic-runbook idempotency keys. Provider calls time out after 20 seconds by default, use the async Gemini transport, and retain truthful fallback provenance. Probe cadence accounts for elapsed work rather than adding the full interval after a slow probe. A one-shot `monitor_iteration()` retains its existing awaited contract for tools/tests; the actual daemon passes the non-blocking processor.
- Triage rechecks state after analysis and uses conditional recovery/review transitions so reset cannot become recovery. Event appenders serialize sequence assignment; normal shutdown cancels and awaits owned tasks and escalates interrupted processing without assuming external action completion. Database write locks are released before provider/runner I/O.
- Dashboard counts/MTTR aggregate in SQL; active incident and latest analyses use bounded queries. Incident lists use batched children, with explicit `include_evidence=false` projection for the frontend and full detail fetched on selection. Existing callers still receive full evidence by default. `before_id` provides stable cursor pagination; the UI still shows its existing latest-50 list. Added service/time, event/sequence, analysis/time, and service/state indexes are created for existing tables during initialization.
- API and worker reuse lifecycle-owned HTTP pools, while one-shot callers own and close their client. Health and runner timeouts remain explicit.
- Measured timestamp-formatting overhead justified reusing `Intl.DateTimeFormat`. No broad React memoization or animation changes were made.

## Production web launcher

Development remains `python start.py`. For a prebuilt web app:

```powershell
cd apps/web
npm ci
npm run build:production
cd ../..
python start.py --production-web
```

`--check` and `--no-browser` still work. Production assets live in `.next-production`, separate from the running dev server's `.next`; the launcher checks for the standalone server and gives build instructions when absent. The build packages static/public assets for the standalone server. Rebuild after source changes. Next.js rewrites capture `API_INTERNAL_URL` at build time; set it before building for non-default deployments. The default local API remains port 8000. This option changes only the web process; the other demo services remain unchanged.

## Repeatable measurements

API benchmark: `python scripts/benchmark_api.py` creates and removes its own SQLite database, seeds synthetic history, warms through 25 calls per endpoint, and reports query count and p50/p95. Set `REBOUND_BENCH_INCIDENTS=5000` for the larger history sample. This measures ASGI handler + SQL + serialization-model construction in-process, not HTTP network time. The same script was run against a separate checkout of the base commit and this branch, on this Windows machine. No live Gemini credentials were used.

| Dataset / endpoint | Before p50 / p95 (ms) | After p50 / p95 (ms) | SQL queries before ? after |
|---|---:|---:|---:|
| 100 incidents / dashboard | 4.14 / 4.82 | 6.08 / 8.44 | 7 ? 8 |
| 100 incidents / 50-item incident list | 73.13 / 91.76 | 5.43 / 8.47 | 151 ? 4 |
| 5,000 incidents / dashboard | 37.71 / 58.53 | 5.97 / 6.62 | 7 ? 8 |
| 5,000 incidents / 50-item incident list | 106.09 / 155.90 | 4.92 / 7.78 | 151 ? 4 |

The small dashboard is slower: there is one extra aggregate/active query in exchange for bounded history materialization. This is not a universal speedup. The list benchmark uses the full-evidence default; the frontend summary projection is cheaper still but was not used to inflate the comparison. Samples are local diagnostics, not load-test capacity or statistically controlled service-level claims.

Browser benchmark: `cd apps/web; npx playwright test e2e/performance.spec.ts`. It starts the isolated real stack, runs two real crash recoveries with unchanged 3-failure/2-verification thresholds, records SSE arrivals, request concurrency, recorded timestamps, a committed acknowledgement's visibility, frame intervals and long tasks. `before-browser.json` records the same test on the base commit. Test polling is 2 seconds in both samples. Dev compilation and system scheduling affect these small samples. Record-to-visible delay includes record creation, commit, delivery, fetch and rendering. Commit-return-to-visible starts after the acknowledgement HTTP response; it is a practical visibility measurement, not an exact database commit clock.

A browser microbenchmark of 1,000 timestamp formatting calls measured 33.5 ms using repeated locale setup versus 0.6 ms reusing a formatter. That justified the focused formatter change; it does not establish an overall dashboard frame-rate improvement.

## Safety and limits

Only one monitoring daemon is supported for health threshold counting. Incident claims defend against duplicate triage, but running multiple probe schedulers against the same services would double-count health observations. SQLite/PostgreSQL share the watermark and query paths; A dedicated PostgreSQL CI job exercises the same tests; local PostgreSQL was not run because the Docker daemon is stopped.

Normal cancellation/SIGTERM on supported event loops drains triage tasks. An abrupt process kill cannot run cleanup: an ANALYZING/RECOVERING incident may require manual investigation rather than automatic replay. An interrupted external action is reported as completion unknown and is never treated as verified recovery. No distributed exactly-once execution across runner restarts is claimed. Existing runner idempotency is retained. No automatic lease/retry system was added.

Watermarks coalesce changes; clients must reconcile snapshots and use audit/detail endpoints for complete history. The recent dashboard samples remain bounded (120 probes/20 events). No event retention or evidence deletion was introduced. Large per-incident histories are intentionally preserved on explicit detail/full-evidence requests. Long-term archival, a multi-worker probe lease and load-testing across many schools remain outside this single-sandbox prototype.

### Observed browser comparison

Same Chromium viewport, Next.js development mode, keyless fallback, two crash runs, isolated processes and unchanged 2-second test cadence. Raw files: [before-browser.json](before-browser.json), [after-browser.json](after-browser.json).

| Measurement | Before | After |
|---|---:|---:|
| Injection ? incident detection, run 1 / 2 | 11,421 / 12,004 ms | 7,563 / 7,137 ms |
| Detection ? analysis record, run 1 / 2 | 26 / 19 ms | 34 / 28 ms |
| Recovery start ? verified resolution, run 1 / 2 | 5,088 / 5,173 ms | 3,999 / 3,990 ms |
| Resolution record ? visible outcome, run 1 / 2 | 4,208 / 4,896 ms | 626 / 417 ms |
| Committed acknowledgement response ? visible event | 4,965 ms | 373 ms |
| Browser frame interval p95 | 16.7 ms | 16.7 ms |
| Longest frame / longest observed task | 133.3 / 138 ms | 133.3 / 145 ms |
| Dashboard requests during measured journey | 11 in 55.4 s | 22 in 27.9 s |
| Maximum concurrent dashboard requests | 1 | 1 |
| Committed SSE messages observed | 0 | 23 |

Analysis persistence was slightly slower in these samples, and rendering did not improve measurably. More dashboard requests after the fix reflect real intermediate probe/incident updates finally arriving, rather than the old five-second polling-only delivery. Request-burst regression checks independently prove coalescing and duplicate-revision suppression; this table does not claim total network traffic fell. The two samples are too small for population-level latency conclusions. Independent verification and exactly one automatic execution per run were asserted in the benchmark, in addition to the existing scenario tests.

Validation: 57 Python tests passed locally, including cross-process commit visibility, rollback, bounded tasks, timeout fallback, reset during analysis, concurrent event sequences, single recovery execution and interrupted-action escalation. All eight Chromium tests passed. TypeScript/regression checks and the standard Next.js production build passed. PostgreSQL 16 passed the 56-test Python suite in CI before the final aggregate-equivalence regression was added; final-head results are recorded in the PR.

Production validation: both `npm run build` and `npm run build:production` passed. The isolated standalone server was started on port 3102 and served its page, a JavaScript asset and the API health proxy with HTTP 200; the smoke process was terminated afterward. Final `npm run check` and `npm run format:check` passed.
