"use client";

import React, { useId, useState } from "react";
import { HealthObservation, Service } from "../types";

export function summarizeChecks(checks: HealthObservation[]) {
  const successful = checks.filter((check) => check.success);
  const latencies = successful
    .map((check) => check.latency_ms)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  return {
    passed: successful.length,
    failed: checks.length - successful.length,
    successRate: checks.length
      ? (successful.length / checks.length) * 100
      : null,
    average: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : null,
    p95: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
  };
}

const timestamp = (value: string) =>
  new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`).getTime();
const clock = (value: string) =>
  new Date(timestamp(value)).toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour12: false,
  });
const ms = (value: number | null) =>
  value == null ? "—" : `${value.toFixed(1)} ms`;

export default function MonitoringCharts({
  observations,
  services,
}: {
  observations: HealthObservation[];
  services: Service[];
}) {
  const [serviceId, setServiceId] = useState("");
  const [sampleCount, setSampleCount] = useState(60);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const prefix = useId();
  const selectedService =
    services.find((service) => service.id === serviceId) || services[0];
  const checks = observations
    .filter(
      (check) =>
        check.service_id === selectedService?.id &&
        Number.isFinite(timestamp(check.observed_at)),
    )
    .sort((a, b) => timestamp(a.observed_at) - timestamp(b.observed_at))
    .slice(-sampleCount);
  const stats = summarizeChecks(checks);
  const selected =
    checks[Math.min(selectedIndex ?? checks.length - 1, checks.length - 1)];
  const start = checks.length ? timestamp(checks[0].observed_at) : 0;
  const duration = checks.length
    ? Math.max(1, timestamp(checks[checks.length - 1].observed_at) - start)
    : 1;
  const maximum = Math.max(
    1,
    ...checks
      .filter((check) => check.success && Number.isFinite(check.latency_ms))
      .map((check) => check.latency_ms),
  );
  const ceiling = Math.max(1, Math.ceil(maximum / 5) * 5);
  const x = (check: HealthObservation) =>
    46 + ((timestamp(check.observed_at) - start) / duration) * 594;
  const y = (check: HealthObservation) =>
    170 - (Math.max(0, check.latency_ms) / ceiling) * 148;
  let connected = false;
  const line = checks
    .map((check) => {
      if (
        !check.success ||
        !Number.isFinite(check.latency_ms) ||
        check.latency_ms < 0
      ) {
        connected = false;
        return "";
      }
      const segment = `${connected ? "L" : "M"}${x(check).toFixed(2)},${y(check).toFixed(2)}`;
      connected = true;
      return segment;
    })
    .join(" ");

  return (
    <section aria-labelledby={`${prefix}-title`} className="monitoring-section">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id={`${prefix}-title`}
            className="text-base font-semibold text-slate-800"
          >
            Recorded checks
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Recorded health checks ·{" "}
            {checks.length
              ? `${clock(checks[0].observed_at)}–${clock(checks[checks.length - 1].observed_at)} MYT`
              : "Waiting for the first check"}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap gap-3">
          {services.length > 1 && (
            <>
              <label className="text-xs text-slate-500">
                Service
                <select
                  value={selectedService?.id || ""}
                  onChange={(event) => {
                    setServiceId(event.target.value);
                    setSelectedIndex(null);
                  }}
                  className="mt-1 block max-w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800"
                >
                  {!services.length && <option value="">No services</option>}
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.display_name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="text-xs text-slate-500">
            Sample window
            <select
              value={sampleCount}
              onChange={(event) => {
                setSampleCount(Number(event.target.value));
                setSelectedIndex(null);
              }}
              className="mt-1 block rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800"
            >
              {[30, 60, 120].map((count) => (
                <option key={count} value={count}>
                  Latest {count} checks
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-6">
        <figure className="min-w-0 border-b border-stone-200 pb-5">
          <figcaption className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                Response time
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Successful checks only
              </p>
            </div>
            <dl className="flex gap-5 text-right">
              <div>
                <dt className="text-xs text-slate-500">Average</dt>
                <dd className="mt-1 font-mono text-sm text-slate-800">
                  {ms(stats.average)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">95th percentile</dt>
                <dd className="mt-1 font-mono text-sm text-slate-800">
                  {ms(stats.p95)}
                </dd>
              </div>
            </dl>
          </figcaption>
          {checks.length ? (
            <>
              <svg
                viewBox="0 0 660 210"
                role="img"
                aria-labelledby={`${prefix}-chart-title ${prefix}-chart-description`}
                className="mt-4 w-full overflow-visible"
                onPointerMove={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const pointer =
                    ((event.clientX - bounds.left) / bounds.width) * 660;
                  let closest = 0;
                  checks.forEach((check, index) => {
                    if (
                      Math.abs(x(check) - pointer) <
                      Math.abs(x(checks[closest]) - pointer)
                    )
                      closest = index;
                  });
                  setSelectedIndex(closest);
                }}
              >
                <title
                  id={`${prefix}-chart-title`}
                >{`Response time for ${selectedService?.display_name}`}</title>
                <desc id={`${prefix}-chart-description`}>
                  {checks.length} checks. Average {ms(stats.average)}. Failed
                  checks are marked with crosses and break the latency line. Use
                  the check inspector below for exact values.
                </desc>
                {[0, 0.5, 1].map((fraction) => (
                  <g key={fraction}>
                    <line
                      x1="46"
                      x2="640"
                      y1={170 - fraction * 148}
                      y2={170 - fraction * 148}
                      stroke="var(--plot-grid)"
                      strokeDasharray="3 4"
                    />
                    <text
                      x="36"
                      y={174 - fraction * 148}
                      fill="var(--plot-label)"
                      textAnchor="end"
                      fontSize="11"
                    >
                      {(fraction * ceiling).toFixed(ceiling < 5 ? 1 : 0)}
                    </text>
                  </g>
                ))}
                <text x="46" y="12" fill="var(--plot-label)" fontSize="10">
                  ms
                </text>
                <path
                  d={line}
                  fill="none"
                  stroke="var(--plot-line)"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                {checks.map((check) =>
                  check.success &&
                  Number.isFinite(check.latency_ms) &&
                  check.latency_ms >= 0 ? (
                    <circle
                      key={check.id}
                      cx={x(check)}
                      cy={y(check)}
                      r="2.5"
                      fill="var(--plot-line)"
                    >
                      <title>{`${clock(check.observed_at)} - ${ms(check.latency_ms)}`}</title>
                    </circle>
                  ) : (
                    <path
                      key={check.id}
                      d={`M${x(check) - 3},164 l6,6 m-6,0 l6,-6`}
                      stroke="var(--plot-failure)"
                      strokeWidth="2"
                    >
                      <title>{`${clock(check.observed_at)} - Failed check`}</title>
                    </path>
                  ),
                )}
                {selected && (
                  <line
                    x1={x(selected)}
                    x2={x(selected)}
                    y1="22"
                    y2="175"
                    stroke="var(--plot-label)"
                    strokeDasharray="3 3"
                  />
                )}
                <text x="46" y="199" fill="var(--plot-label)" fontSize="11">
                  {clock(checks[0].observed_at)}
                </text>
                <text
                  x="640"
                  y="199"
                  fill="var(--plot-label)"
                  textAnchor="end"
                  fontSize="11"
                >
                  {clock(checks[checks.length - 1].observed_at)}
                </text>
              </svg>
              {stats.average == null && (
                <p className="text-xs text-rose-700">
                  No successful response times in this sample.
                </p>
              )}
            </>
          ) : (
            <div className="flex min-h-52 items-center justify-center text-sm text-slate-500">
              No recorded checks for this service yet.
            </div>
          )}
        </figure>

        <figure className="min-w-0 border-b border-stone-200 pb-5">
          <figcaption className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-stone-800">
                Check history
              </h3>
              <p className="mt-1 text-xs text-stone-500">
                Success rate in this sample, not time-based uptime
              </p>
            </div>
            <p className="text-sm text-stone-600">
              <strong className="font-mono font-medium text-stone-900">
                {stats.successRate == null
                  ? "?"
                  : `${stats.successRate.toFixed(1)}%`}
              </strong>{" "}
              passed <span className="mx-2 text-stone-300">/</span>
              {stats.failed} failed{" "}
              <span className="mx-2 text-stone-300">/</span>
              {checks.length} total
            </p>
          </figcaption>
          {checks.length > 0 && (
            <>
              <svg
                viewBox={`0 0 ${checks.length * 6} 28`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${checks.length} checks from oldest to newest: ${stats.passed} passed and ${stats.failed} failed`}
                className="mt-4 h-6 w-full"
              >
                {checks.map((check, index) => (
                  <rect
                    key={check.id}
                    x={index * 6}
                    y="0"
                    width="4"
                    height={check.success ? 24 : 28}
                    rx="0"
                    fill={
                      check.success ? "var(--plot-line)" : "var(--plot-failure)"
                    }
                  >
                    <title>{`${clock(check.observed_at)} - ${check.success ? "Passed" : "Failed"}`}</title>
                  </rect>
                ))}
              </svg>
              <div className="mt-2 flex justify-between text-xs text-stone-500">
                <span>Oldest recorded check</span>
                <span>Latest</span>
              </div>
            </>
          )}
        </figure>
      </div>

      {selected && (
        <details className="mt-3 border-b border-stone-200 py-2 text-xs text-slate-500">
          <summary className="cursor-pointer py-2">
            Inspect recorded checks · {clock(selected.observed_at)} MYT ·{" "}
            {selected.success ? "Passed" : "Failed"}
          </summary>
          <label className="mt-2 block">
            Check{" "}
            {Math.min(selectedIndex ?? checks.length - 1, checks.length - 1) +
              1}{" "}
            of {checks.length}
            <input
              aria-label="Choose recorded health check"
              type="range"
              min="0"
              max={Math.max(0, checks.length - 1)}
              value={Math.min(
                selectedIndex ?? checks.length - 1,
                checks.length - 1,
              )}
              onChange={(event) => setSelectedIndex(Number(event.target.value))}
              className="block w-full accent-blue-400"
            />
          </label>
          <dl className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt>Result</dt>
              <dd className="mt-1 text-slate-800">
                {selected.success ? "Passed" : "Failed"}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd className="mt-1 text-slate-800">
                {Number.isFinite(selected.latency_ms)
                  ? ms(selected.latency_ms)
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>HTTP status</dt>
              <dd className="mt-1 text-slate-800">
                {selected.http_status ?? "No response"}
              </dd>
            </div>
            <div>
              <dt>Error</dt>
              <dd className="mt-1 break-all text-slate-800">
                {selected.error_type || "None"}
              </dd>
            </div>
          </dl>
          <p className="my-3 break-all font-mono">
            {selected.sanitized_details || "No additional details recorded."}
          </p>
        </details>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Up to 120 latest recorded checks across all services are retained in
        this view. Missing history is not counted as healthy.
      </p>
    </section>
  );
}
