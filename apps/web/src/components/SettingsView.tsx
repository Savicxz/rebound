"use client";

import React, { useEffect, useState } from "react";
import { DashboardMetrics } from "../types";

export default function SettingsView({
  metrics,
}: {
  currentUser: { username: string; role: string };
  metrics?: DashboardMetrics;
}) {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(
    null,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/settings", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Settings unavailable");
        setSettings(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  const providerLabels = {
    not_configured: "No Gemini API key configured",
    configured: "Configured; no recorded result yet",
    verified: "Latest recorded analysis used Gemini successfully",
    fallback: "Latest recorded analysis used demo fallback",
    enterprise_unavailable: "Enterprise adapter is not connected",
  };
  const rows = [
    [
      "Health check interval",
      settings ? `${settings.health_interval} seconds` : "Not loaded",
    ],
    [
      "Health check timeout",
      settings ? `${settings.health_timeout} seconds` : "Not loaded",
    ],
    ["Failures before incident", settings?.failure_threshold ?? "Not loaded"],
    [
      "Slow response threshold",
      settings ? `${settings.latency_limit_ms} ms` : "Not loaded",
    ],
    [
      "Successful checks before resolution",
      settings?.verification_threshold ?? "Not loaded",
    ],
    [
      "Maximum automatic attempts",
      settings?.max_auto_recovery_attempts ?? "Not loaded",
    ],
    [
      "Recovery cooldown",
      settings ? `${settings.cooldown_seconds} seconds` : "Not loaded",
    ],
    ["Gemini model", settings?.gemini_model ?? "Not loaded"],
    [
      "Gemini status",
      metrics ? providerLabels[metrics.gemini_status] : "No status loaded",
    ],
    [
      "Last analysis provider",
      metrics?.last_analysis_provider ?? "No analysis recorded",
    ],
    ["Last analysis time", metrics?.last_analysis_at ?? "No analysis recorded"],
    ["Gemini Enterprise", "Reserved interface only; no execution verified"],
  ];
  return (
    <section className="max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          Runtime settings
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          Read-only configuration. Change environment variables and restart the
          services to apply updates.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          Could not load runtime settings. Refresh this view to retry.
        </p>
      )}
      <dl className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white px-5">
        {rows.map(([label, value]) => (
          <div
            key={String(label)}
            className="grid gap-2 py-4 text-sm sm:grid-cols-2"
          >
            <dt className="text-stone-500">{String(label)}</dt>
            <dd className="break-words text-stone-800">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-stone-500">
        Configured credentials are not evidence of a working connection.
        Provider status describes recorded analyses, not a continuous
        connectivity test.
      </p>
    </section>
  );
}
