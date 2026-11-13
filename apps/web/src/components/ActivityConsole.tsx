"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Circle, Pause, AlertTriangle, ArrowRight } from "lucide-react";
import { Incident } from "../types";
import {
  activityRows,
  hasHistoryGap,
  mergeActivity,
  PLAYBACK_INTERVAL_MS,
} from "../lib/activity-console";
import { formatClock, utcTime } from "../lib/demo-workflow";
import { providerName } from "./IncidentSummary";

export default function ActivityConsole({
  incident,
  guided = false,
  stale = false,
  waiting = false,
  reserveResult = false,
  children,
}: {
  incident: Incident | null;
  guided?: boolean;
  stale?: boolean;
  waiting?: boolean;
  reserveResult?: boolean;
  children?: React.ReactNode;
}) {
  const [rows, setRows] = useState(() => activityRows(incident));
  const [visible, setVisible] = useState<string[]>(() =>
    guided ? [] : activityRows(incident).map((row) => row.key),
  );
  const [presenting, setPresenting] = useState(guided);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const feed = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (incident)
      setRows((previous) =>
        mergeActivity(previous, activityRows(incident), incident.id),
      );
  }, [incident]);
  useEffect(() => {
    if (stale) setPaused(true);
  }, [stale]);
  useEffect(() => {
    if (stale || paused) return;
    if (reduced || !presenting) {
      const keys = rows.map((row) => row.key);
      setVisible((previous) =>
        previous.join("|") === keys.join("|") ? previous : keys,
      );
      if (reduced) setPresenting(false);
      return;
    }
  }, [rows, presenting, paused, stale, reduced]);
  const nextKey = rows.find((row) => !visible.includes(row.key))?.key;
  useEffect(() => {
    if (!presenting || reduced || paused || stale || !nextKey) return;
    const timer = window.setTimeout(
      () => setVisible((previous) => [...previous, nextKey]),
      PLAYBACK_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [nextKey, presenting, paused, stale, reduced]);
  const shown = rows.filter((row) => visible.includes(row.key));
  const signature = shown.map((row) => row.key).join("|");
  useEffect(() => {
    if (follow.current && feed.current)
      feed.current.scrollTo({
        top: feed.current.scrollHeight,
        behavior: reduced ? "auto" : "smooth",
      });
  }, [signature, reduced]);
  const terminal =
    !!incident &&
    ["RESOLVED", "AWAITING_APPROVAL", "ESCALATED", "CLOSED"].includes(
      incident.state,
    );
  const allShown = rows.every((row) => visible.includes(row.key));
  const finished = terminal && allShown;
  const verified = incident?.state === "RESOLVED" && !!incident.resolved_at;
  const resolvedShown = shown.some((row) => row.type === "INCIDENT_RESOLVED");
  const waitingForEvidence =
    waiting && !terminal && allShown && !stale && !paused;
  function skip() {
    setPresenting(false);
    setPaused(false);
    setVisible(rows.map((row) => row.key));
    follow.current = true;
    feed.current?.focus({ preventScroll: true });
  }
  function replay() {
    follow.current = true;
    setPaused(false);
    setPresenting(!reduced);
    setVisible(reduced ? rows.map((row) => row.key) : []);
    feed.current?.focus({ preventScroll: true });
  }
  return (
    <section
      className="activity-console"
      aria-label="Analysis and safety decision"
    >
      <header className="activity-console-header">
        <div>
          <p className="font-medium">Recorded activity</p>
          <p className="mt-1 text-xs text-stone-600">
            {incident ? providerName(incident) : "No analysis recorded yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(presenting || paused) && !finished && (
            <button
              className="ui-button"
              disabled={stale}
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? "Resume presentation" : "Pause presentation"}
            </button>
          )}
          {presenting && !allShown && (
            <button className="ui-button" disabled={stale} onClick={skip}>
              Skip to latest
            </button>
          )}
          {terminal && allShown && rows.length > 0 && (
            <button className="ui-button" disabled={stale} onClick={replay}>
              Replay recorded activity
            </button>
          )}
        </div>
      </header>
      <p className="activity-mode text-xs text-stone-500">
        {presenting
          ? finished
            ? "Guided playback complete. Backend status above is current."
            : paused
              ? "Presentation paused. Backend status above remains current."
              : "Guided playback of committed evidence. Backend status above is current."
          : "Current recorded evidence. Backend status above is current."}
      </p>
      {stale && (
        <p role="alert" className="activity-warning">
          Fresh evidence is unavailable. Presentation paused; no outcome is
          inferred.
        </p>
      )}
      {incident && hasHistoryGap(incident.events, incident.id) && (
        <p className="activity-warning">
          Some event history is unavailable. Missing stages are not inferred.
        </p>
      )}
      <ol
        ref={feed}
        className="activity-feed"
        aria-label="Recorded activity"
        aria-live="off"
        tabIndex={0}
        onScroll={() => {
          const element = feed.current;
          if (element)
            follow.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              48;
        }}
      >
        {shown.map((row, index) => (
          <li
            key={row.key}
            data-event-type={row.type}
            data-sequence={row.sequence}
            data-tone={row.tone}
            className={`activity-entry ${index === shown.length - 1 ? "activity-latest" : "activity-history"}`}
          >
            <time
              dateTime={Number.isFinite(utcTime(row.at)) ? row.at : undefined}
            >
              {Number.isFinite(utcTime(row.at))
                ? formatClock(row.at)
                : "Time not recorded"}
            </time>
            <span className="activity-mark" aria-hidden="true">
              {row.tone === "failure" ? (
                <AlertTriangle />
              ) : row.tone === "review" ? (
                <Pause />
              ) : row.tone === "success" ? (
                <Check />
              ) : (
                <Circle />
              )}
            </span>
            <div>
              <h3 className="font-medium">{row.title}</h3>
              {row.detail && (
                <p className="mt-1 text-xs leading-relaxed">{row.detail}</p>
              )}
            </div>
          </li>
        ))}
        {!shown.length && (
          <li className="activity-empty">
            {rows.length && presenting
              ? "Recorded evidence is ready for guided playback."
              : "No incident events recorded yet."}
          </li>
        )}
      </ol>
      <div className="activity-footer text-xs text-stone-600">
        {waitingForEvidence ? (
          <>
            <span className="activity-wait" aria-hidden="true" />
            Waiting for real evidence
          </>
        ) : (
          <>
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            {finished
              ? "Recorded activity complete"
              : paused
                ? "Presentation paused"
                : "Only committed events appear here"}
          </>
        )}
      </div>
      {verified && !rows.some((row) => row.type === "INCIDENT_RESOLVED") && (
        <p className="activity-warning">
          The backend reports resolution, but its verification-completed event
          is unavailable.
        </p>
      )}
      {(reserveResult || children) && (
        <div className="activity-result-slot">
          {verified && resolvedShown && children && (
            <div
              className="activity-result"
              aria-label="Verified attendance outcome"
            >
              {children}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
