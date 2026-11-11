"use client";

import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { IncidentEvent } from "../types";

export function formatPayload(value?: string | null) {
  if (!value) return "No metadata recorded for this event.";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
const date = (value: string) =>
  new Date(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`,
  ).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour12: false });

export default function AuditView({ events }: { events: IncidentEvent[] }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IncidentEvent | null>(null);
  const [history, setHistory] = useState<IncidentEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  async function load(before?: string, signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/audit-events?limit=50${before ? `&before_id=${encodeURIComponent(before)}` : ""}`,
        { signal },
      );
      if (response.status === 404) {
        setCursor(null);
        throw new Error(
          "Audit history changed. Retry to reload the latest events.",
        );
      }
      if (!response.ok)
        throw new Error(
          "Could not load audit history. The recent events are still available below.",
        );
      const page = await response.json();
      setHistory((previous) =>
        before ? [...previous, ...page.events] : page.events,
      );
      setCursor(page.next_cursor);
    } catch (reason) {
      if (!signal?.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load audit history.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(undefined, controller.signal);
    return () => controller.abort();
  }, []);
  const all = [
    ...new Map(
      [...history, ...events].map((event) => [event.id, event]),
    ).values(),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const filtered = all.filter((event) =>
    [
      event.event_type,
      event.public_message,
      event.actor_id,
      event.incident_id,
      event.id,
      String(event.sequence),
      event.metadata_json || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const inspect = (event: IncidentEvent) => (
    <button
      onClick={() => setSelected(event)}
      aria-label={`Inspect event ${event.event_type}, incident ${event.incident_id}, sequence ${event.sequence}`}
      className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      Inspect
    </button>
  );

  return (
    <section className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Audit trail
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Full messages and recorded payloads. Sequence numbers belong to each
            incident.
          </p>
        </div>
        <label className="max-w-full text-xs text-stone-500">
          Search loaded events
          <div className="relative mt-1">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-3 h-4 w-4"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Message, actor, incident or payload"
              className="w-80 max-w-full rounded-md border border-stone-200 bg-white pl-9 pr-3 text-sm text-stone-800"
            />
          </div>
        </label>
      </header>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 p-3 text-sm text-amber-800"
        >
          {error}
          <button
            onClick={() => load(cursor || undefined)}
            disabled={loading}
            className="min-h-11 underline"
          >
            Retry
          </button>
        </div>
      )}
      <p className="text-xs text-stone-500">
        {filtered.length} matching / {all.length} loaded.{" "}
        {cursor
          ? "Load older events to search further back."
          : loading
            ? "Loading history..."
            : "End of loaded history."}
      </p>
      <div className="hidden min-w-0 overflow-hidden rounded-md border border-stone-200 bg-white lg:block">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">
            Recorded audit events, newest first. Inspect any event to see its
            complete data.
          </caption>
          <colgroup>
            <col className="w-[19%]" />
            <col className="w-[25%]" />
            <col />
            <col className="w-20" />
          </colgroup>
          <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
            <tr>
              <th scope="col" className="p-4 font-medium">
                Time / incident
              </th>
              <th scope="col" className="p-4 font-medium">
                Actor / event
              </th>
              <th scope="col" className="p-4 font-medium">
                Recorded message
              </th>
              <th scope="col" className="p-3">
                <span className="sr-only">Inspect data</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {filtered.map((event) => (
              <tr key={event.id} className="align-top hover:bg-stone-50/50">
                <td className="p-4">
                  <time
                    dateTime={event.at}
                    className="block text-xs tabular-nums text-stone-700"
                  >
                    {date(event.at)} MYT
                  </time>
                  <p className="mt-2 break-all font-mono text-xs text-stone-500">
                    {event.incident_id.slice(0, 8)} / #{event.sequence}
                  </p>
                </td>
                <td className="p-4">
                  <p className="break-words font-medium text-stone-800">
                    {event.actor_id}
                  </p>
                  <code className="mt-2 block break-all text-xs text-stone-500">
                    {event.event_type}
                  </code>
                </td>
                <td className="whitespace-pre-wrap break-words p-4 leading-relaxed text-stone-700 [overflow-wrap:anywhere]">
                  {event.public_message}
                </td>
                <td className="p-2">{inspect(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="divide-y divide-stone-200 border-y border-stone-200 lg:hidden">
        {filtered.map((event) => (
          <li key={event.id} className="space-y-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
              <time dateTime={event.at}>{date(event.at)} MYT</time>
              <span>
                {event.incident_id.slice(0, 8)} / #{event.sequence}
              </span>
            </div>
            <p className="break-words text-sm font-medium text-stone-800">
              {event.actor_id}
            </p>
            <code className="block break-all text-xs text-stone-500">
              {event.event_type}
            </code>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-700 [overflow-wrap:anywhere]">
              {event.public_message}
            </p>
            {inspect(event)}
          </li>
        ))}
      </ol>
      {!filtered.length && (
        <p className="py-8 text-sm text-stone-500">
          No audit records match the current filter.
        </p>
      )}
      {cursor && (
        <button
          onClick={() => load(cursor)}
          disabled={loading}
          className="min-h-11 rounded-md border border-stone-300 px-4 text-sm text-stone-700 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load older events"}
        </button>
      )}
      {selected && (
        <dialog
          ref={dialog}
          onClose={() => setSelected(null)}
          aria-labelledby="audit-detail-title"
          className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-lg border border-stone-200 bg-white p-0 text-stone-800 shadow-xl backdrop:bg-black/50"
        >
          <div className="flex max-h-[90vh] flex-col">
            <header className="flex items-start justify-between gap-4 border-b border-stone-200 p-5">
              <div className="min-w-0">
                <h2
                  id="audit-detail-title"
                  className="break-all text-base font-semibold"
                >
                  {selected.event_type}
                </h2>
                <p className="mt-2 text-xs text-stone-500">
                  {date(selected.at)} MYT
                </p>
              </div>
              <button
                onClick={() => dialog.current?.close()}
                aria-label="Close audit details"
                className="flex min-h-11 min-w-11 items-center justify-center"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 overflow-y-auto p-5">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                {[
                  ["Incident ID", selected.incident_id],
                  ["Event ID", selected.id],
                  ["Actor", `${selected.actor_type} / ${selected.actor_id}`],
                  ["Incident sequence", `#${selected.sequence}`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-stone-500">{label}</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <section>
                <h3 className="mb-2 text-sm font-medium">Full message</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
                  {selected.public_message}
                </p>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Recorded payload</h3>
                <pre className="whitespace-pre-wrap break-all rounded-md border border-stone-200 bg-stone-50 p-4 font-mono text-xs leading-relaxed">
                  {formatPayload(selected.metadata_json)}
                </pre>
              </section>
            </div>
            <footer className="flex justify-end border-t border-stone-200 p-4">
              <button
                onClick={() => dialog.current?.close()}
                className="min-h-11 rounded-md border border-stone-300 px-4 text-sm"
              >
                Close
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </section>
  );
}
