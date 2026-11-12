"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ShieldAlert,
  Search,
  Filter,
  Eye,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Brain,
  Terminal,
} from "lucide-react";
import { Incident } from "../types";
import ActivityIndicator from "./ActivityIndicator";

interface IncidentsViewProps {
  incidents: Incident[];
  onSelectIncident?: (id: string) => void;
  error?: string | null;
  loading?: boolean;
  onRetry?: () => void;
}

export default function IncidentsView({
  incidents,
  error,
  loading = false,
  onRetry,
}: IncidentsViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterState, setFilterState] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedSummary =
    incidents.find((incident) => incident.id === selectedId) || null;
  const [detail, setDetail] = useState<Incident | null>(null);
  const [detailPending, setDetailPending] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const selectedIncident = detail?.id === selectedId ? detail : selectedSummary;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetailPending(true);
    setDetailError(false);
    fetch(`/api/v1/incidents/${encodeURIComponent(selectedId)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Incident unavailable");
        const data: Incident = await response.json();
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailPending(false);
      });
    return () => controller.abort();
  }, [
    selectedId,
    selectedSummary?.version,
    selectedSummary?.state,
    detailRetry,
  ]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selectedIncident && !dialogRef.current?.open)
      dialogRef.current?.showModal();
  }, [selectedIncident]);

  const filtered = incidents.filter((inc) => {
    const matchesSearch =
      inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.fingerprint.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterState === "ALL" || inc.state === filterState;
    return matchesSearch && matchesFilter;
  });

  const formatTimestamp = (ts?: string | null) => {
    if (!ts) return "Unavailable";
    try {
      const d = new Date(ts);
      return (
        d.toLocaleString("en-MY", {
          timeZone: "Asia/Kuala_Lumpur",
          hour12: false,
        }) + " MYT"
      );
    } catch {
      return ts;
    }
  };

  const getDuration = (inc: Incident) => {
    if (!inc.resolved_at)
      return inc.state === "CLOSED"
        ? "Closed without verified recovery"
        : "Ongoing";
    try {
      const start = new Date(inc.detected_at).getTime();
      const end = new Date(inc.resolved_at).getTime();
      const diffSec = Math.round((end - start) / 1000);
      return Number.isFinite(diffSec) && diffSec >= 0
        ? `${diffSec}s`
        : "Unavailable";
    } catch {
      return "Unavailable";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="ui-eyebrow">Operations / history</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900">
            Incidents
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Recorded service incidents and investigation history.
          </p>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              aria-label="Search incidents by title, fingerprint or ID"
              placeholder="Search by title, ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-stone-300 w-48 sm:w-64"
            />
          </div>

          <select
            aria-label="Filter incidents by state"
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-stone-300"
          >
            <option value="ALL">All States</option>
            <option value="OPEN">Open</option>
            <option value="SUSPECTED">Suspected</option>
            <option value="ANALYZING">Analysing</option>
            <option value="ACTION_RECOMMENDED">Action recommended</option>
            <option value="RECOVERING">Recovering</option>
            <option value="VERIFYING">Verifying</option>
            <option value="AWAITING_APPROVAL">Awaiting Approval</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ESCALATED">Escalated</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="ui-notice flex flex-wrap items-center justify-between gap-3"
        >
          {error}
          {onRetry && (
            <button className="ui-button" onClick={onRetry}>
              Retry history
            </button>
          )}
        </div>
      )}
      {loading && (
        <div role="status" className="ui-panel p-6">
          <p className="flex items-center gap-3 text-sm text-stone-600">
            <ActivityIndicator />
            Loading incident history
          </p>
          <div className="mt-5 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton h-14" />
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3 md:hidden" aria-label="Incident cards">
        {!loading &&
          filtered.map((inc) => (
            <article key={inc.id} className="ui-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  className={`state-tag ${inc.state === "RESOLVED" ? "state-verified" : inc.state === "CLOSED" ? "state-reset" : "state-review"}`}
                >
                  {inc.state.replaceAll("_", " ")}
                </span>
                <span className="text-xs text-stone-500">{inc.severity}</span>
              </div>
              <h3 className="mt-3 text-base font-semibold text-stone-900">
                {inc.title}
              </h3>
              <p className="mt-2 text-xs text-stone-500">
                {formatTimestamp(inc.detected_at)}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Recovery: {getDuration(inc)}
              </p>
              <button
                className="ui-button mt-4 w-full"
                onClick={() => setSelectedId(inc.id)}
              >
                View incident evidence
              </button>
            </article>
          ))}
        {!loading && !filtered.length && (
          <p className="ui-notice">No incidents matching current criteria.</p>
        )}
      </div>
      {/* Incidents Table */}
      <div className="ui-panel hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Incident ID</th>
                <th className="px-4 py-3">Title & Target</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Detected At</th>
                <th className="px-4 py-3">Recovery time</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No incidents matching current criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((inc) => (
                  <tr
                    key={inc.id}
                    className="hover:bg-slate-100/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {inc.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">
                        {inc.title}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {inc.fingerprint}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          inc.severity === "CRITICAL"
                            ? "bg-stone-100/20 text-stone-700 border border-stone-300/30"
                            : inc.severity === "HIGH"
                              ? "bg-stone-100/20 text-stone-900 border border-stone-300/30"
                              : "bg-stone-100/20 text-stone-700"
                        }`}
                      >
                        {inc.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`state-tag ${inc.state === "RESOLVED" ? "state-verified" : inc.state === "CLOSED" ? "state-reset" : ["AWAITING_APPROVAL", "ESCALATED"].includes(inc.state) ? "state-review" : ""}`}
                      >
                        {inc.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatTimestamp(inc.detected_at)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {getDuration(inc)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedId(inc.id)}
                        aria-label={`View details for ${inc.title}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded border border-slate-200 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Incident Detail Modal / Drawer */}
      {selectedIncident && (
        <dialog
          ref={dialogRef}
          onClose={() => setSelectedId(null)}
          aria-labelledby="incident-detail-title"
          className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[85vh] rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
        >
          <div className="flex max-h-[85vh] flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <span className="text-xs font-mono text-slate-500 break-all">
                  INCIDENT ID: {selectedIncident.id}
                </span>
                <h3
                  id="incident-detail-title"
                  className="text-lg font-bold text-slate-900 mt-1"
                >
                  {selectedIncident.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Detected: {formatTimestamp(selectedIncident.detected_at)} /
                  State: {selectedIncident.state}
                </p>
              </div>
              <button
                onClick={() => dialogRef.current?.close()}
                aria-label="Close incident details"
                className="ui-button text-slate-500"
              >
                Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {detailPending ? (
                <p role="status" className="flex items-center gap-3">
                  <ActivityIndicator />
                  Loading recorded evidence
                </p>
              ) : detailError ? (
                <div role="alert">
                  Incident evidence could not be loaded.
                  <button
                    className="ui-button ml-3"
                    onClick={() => setDetailRetry((value) => value + 1)}
                  >
                    Retry evidence
                  </button>
                </div>
              ) : (
                <>
                  <section
                    className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3"
                    aria-label="Incident outcome"
                  >
                    <div>
                      <p className="text-slate-500">Severity</p>
                      <p className="mt-1 font-semibold">
                        {selectedIncident.severity}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Recovery time</p>
                      <p className="mt-1 font-semibold">
                        {selectedIncident.state === "CLOSED" &&
                        !selectedIncident.resolved_at
                          ? "Closed without verified recovery"
                          : getDuration(selectedIncident)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Verified recovery</p>
                      <p className="mt-1 font-semibold">
                        {selectedIncident.resolved_at
                          ? formatTimestamp(selectedIncident.resolved_at)
                          : "Not recorded"}
                      </p>
                    </div>
                  </section>
                  {selectedIncident.last_error && (
                    <section className="rounded-lg border border-slate-200 p-4">
                      <h4 className="font-semibold text-slate-700">
                        Observed error
                      </h4>
                      <pre className="mt-2 whitespace-pre-wrap break-all text-slate-500">
                        {selectedIncident.last_error}
                      </pre>
                    </section>
                  )}
                  {/* AI Triage Diagnosis */}
                  {selectedIncident.latest_analysis ? (
                    <div className="bg-slate-50/80 border border-stone-300/30 rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-stone-700 uppercase tracking-wider text-xs flex items-center gap-1.5">
                          <Brain className="w-3.5 h-3.5" /> AI Triage Assessment
                          ({selectedIncident.latest_analysis.provider})
                        </span>
                        <span className="text-xs bg-stone-100/10 text-stone-700 border border-stone-300/30 px-2 py-0.5 rounded font-mono">
                          Confidence:{" "}
                          {selectedIncident.latest_analysis.confidence}
                        </span>
                      </div>
                      <p className="text-sm text-slate-800">
                        {selectedIncident.latest_analysis.summary}
                      </p>
                      <p className="font-semibold text-stone-900">
                        {selectedIncident.latest_analysis.requires_human_review
                          ? "Human review required"
                          : "Recommended action remains subject to safety checks"}
                      </p>
                      <div>
                        <span className="text-slate-500 font-medium">
                          Suspected Root Cause:{" "}
                        </span>
                        <span className="text-slate-800">
                          {selectedIncident.latest_analysis.suspected_cause}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-medium">
                          Reasoning:{" "}
                        </span>
                        <span className="text-slate-700">
                          {selectedIncident.latest_analysis.reasoning_summary}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-medium">
                          Allowlisted Runbook Proposed:{" "}
                        </span>
                        <code className="text-stone-700 font-mono bg-stone-100/40 px-1 py-0.5 rounded">
                          {selectedIncident.latest_analysis
                            .recommended_runbook_id || "None"}
                        </code>
                      </div>
                      <details className="pt-2 text-slate-500">
                        <summary className="cursor-pointer py-2">
                          Evidence references (
                          {
                            selectedIncident.latest_analysis.evidence_event_ids
                              .length
                          }
                          )
                        </summary>
                        {selectedIncident.latest_analysis.evidence_event_ids
                          .length ? (
                          <ul className="space-y-1">
                            {selectedIncident.latest_analysis.evidence_event_ids.map(
                              (id, index) => (
                                <li
                                  className="break-all font-mono"
                                  key={`${id}-${index}`}
                                >
                                  {id}
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p>No evidence references recorded.</p>
                        )}
                      </details>
                    </div>
                  ) : (
                    <p className="text-slate-500 italic">
                      No structured AI analysis recorded for this incident.
                    </p>
                  )}

                  {/* Runbook Executions */}
                  {selectedIncident.runbook_executions.length > 0 ? (
                    <div>
                      <h4 className="font-bold text-slate-700 uppercase text-xs mb-2">
                        Runbook Execution Log
                      </h4>
                      <div className="space-y-2">
                        {selectedIncident.runbook_executions.map((rb) => (
                          <div
                            key={rb.id}
                            className="bg-slate-50 border border-slate-200 p-3 rounded font-mono text-xs"
                          >
                            <div className="flex justify-between text-slate-700">
                              <span>{rb.runbook_id}</span>
                              <span
                                className={`font-bold ${rb.status === "SUCCESS" ? "text-stone-700" : rb.status === "FAILED" ? "text-stone-700" : "text-stone-900"}`}
                              >
                                {rb.status}
                              </span>
                            </div>
                            <p className="mt-2 text-slate-500">
                              Started: {formatTimestamp(rb.started_at)} /
                              Finished: {formatTimestamp(rb.finished_at)}
                            </p>
                            <p className="mt-1 break-all text-slate-500">
                              Approval:{" "}
                              {rb.approval_actor_id ||
                                "No administrator approval recorded"}
                            </p>
                            <div className="text-slate-500 mt-1">
                              Idempotency Key: {rb.idempotency_key}
                            </div>
                            {rb.runner_response_redacted && (
                              <div className="text-slate-500 mt-1">
                                Response: {rb.runner_response_redacted}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-slate-200 p-4 text-slate-500">
                      No recovery actions recorded for this incident.
                    </p>
                  )}

                  {/* Event Sequence */}
                  <div>
                    <h4 className="font-bold text-slate-700 uppercase text-xs mb-2 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5" /> Chronological Event
                      Trail ({selectedIncident.events.length})
                    </h4>
                    <div className="space-y-2 pr-1">
                      {selectedIncident.events.length === 0 && (
                        <p className="text-slate-500">
                          No timeline events recorded yet.
                        </p>
                      )}
                      {[...selectedIncident.events]
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((e) => (
                          <div
                            key={e.id}
                            className="border-l-2 border-slate-200 pl-3 py-1 text-xs"
                          >
                            <div className="flex justify-between text-slate-500">
                              <span className="font-semibold text-slate-800">
                                {e.event_type
                                  .toLowerCase()
                                  .replaceAll("_", " ")}
                              </span>
                              <span>{formatTimestamp(e.at)}</span>
                            </div>
                            <div className="text-slate-700">
                              {e.public_message}
                            </div>
                            <div className="mt-1 text-slate-500">
                              {e.actor_type} / {e.actor_id}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => dialogRef.current?.close()}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
