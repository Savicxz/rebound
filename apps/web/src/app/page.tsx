"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import ActivityIndicator from "../components/ActivityIndicator";
import Navbar from "../components/Navbar";
import OverviewView from "../components/OverviewView";
import IncidentsView from "../components/IncidentsView";
import AuditView from "../components/AuditView";
import DemoControlsView from "../components/DemoControlsView";
import SettingsView from "../components/SettingsView";
import SignIn from "../components/SignIn";
import { DashboardData, Incident, DemoScenarioId } from "../types";

export default function Home() {
  const [currentTab, setCurrentTab] = useState("overview");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [incidentsLoaded, setIncidentsLoaded] = useState(false);
  const dashboardRequest = useRef(0);
  const dashboardFlight = useRef<Promise<void> | null>(null);
  const dashboardQueued = useRef(false);
  const incidentFlight = useRef<Promise<void> | null>(null);
  const incidentQueued = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const incidentRequest = useRef(0);
  const currentTabRef = useRef(currentTab);
  currentTabRef.current = currentTab;
  const [sseConnected, setSseConnected] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Tokens stay in memory; passwords are submitted only through the sign-in form.
  const [currentUser, setCurrentUser] = useState<{
    username: string;
    role: "OPERATOR" | "ADMIN";
    token: string;
  }>({
    username: "Guest",
    role: "OPERATOR",
    token: "",
  });

  // Login handler
  const loginUser = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok)
      throw new Error("Sign-in failed. Check your username and password.");
    if (res.ok) {
      const data = await res.json();
      setCurrentUser({
        username: data.user.username,
        role: data.user.role,
        token: data.access_token,
      });
    }
  }, []);

  // One active request plus one trailing reconciliation per resource. Event bursts
  // cannot overlap requests or overwrite a newer snapshot with an older response.
  const fetchDashboard = useCallback((): Promise<void> => {
    if (dashboardFlight.current) {
      dashboardQueued.current = true;
      return dashboardFlight.current;
    }
    const request = ++dashboardRequest.current;
    const controller = lifetime.current;
    const flight = (async () => {
      do {
        dashboardQueued.current = false;
        try {
          const res = await fetch("/api/v1/dashboard", {
            signal: AbortSignal.any([
              ...(controller ? [controller.signal] : []),
              AbortSignal.timeout(10000),
            ]),
          });
          if (!res.ok) throw new Error(`Dashboard returned HTTP ${res.status}`);
          const data: DashboardData = await res.json();
          if (
            controller?.signal.aborted ||
            request !== dashboardRequest.current
          )
            return;
          setDashboardData((previous) =>
            JSON.stringify(previous) === JSON.stringify(data) ? previous : data,
          );
          setLastUpdated(new Date().toISOString());
          setDashboardError(null);
        } catch {
          if (
            controller?.signal.aborted ||
            request !== dashboardRequest.current
          )
            return;
          setDashboardError(
            "Unable to refresh service data. Check that the API is running and try again.",
          );
        }
      } while (dashboardQueued.current && !controller?.signal.aborted);
    })().finally(() => {
      if (request === dashboardRequest.current) dashboardFlight.current = null;
    });
    dashboardFlight.current = flight;
    return flight;
  }, []);

  const fetchIncidents = useCallback((): Promise<void> => {
    if (incidentFlight.current) {
      incidentQueued.current = true;
      return incidentFlight.current;
    }
    const request = ++incidentRequest.current;
    const controller = lifetime.current;
    const flight = (async () => {
      do {
        incidentQueued.current = false;
        try {
          const res = await fetch("/api/v1/incidents?include_evidence=false", {
            signal: AbortSignal.any([
              ...(controller ? [controller.signal] : []),
              AbortSignal.timeout(10000),
            ]),
          });
          if (!res.ok) throw new Error("Incident history unavailable");
          const data: Incident[] = await res.json();
          if (controller?.signal.aborted || request !== incidentRequest.current)
            return;
          setIncidents((previous) =>
            JSON.stringify(previous) === JSON.stringify(data) ? previous : data,
          );
          setIncidentsError(null);
          setIncidentsLoaded(true);
        } catch {
          if (
            !controller?.signal.aborted &&
            request === incidentRequest.current
          )
            setIncidentsError(
              "Incident history could not be refreshed. Existing records may be stale.",
            );
        }
      } while (incidentQueued.current && !controller?.signal.aborted);
    })().finally(() => {
      if (request === incidentRequest.current) incidentFlight.current = null;
    });
    incidentFlight.current = flight;
    return flight;
  }, []);

  useEffect(() => {
    lifetime.current = new AbortController();
    dashboardFlight.current = null;
    incidentFlight.current = null;
    void fetchDashboard();
    return () => {
      lifetime.current?.abort();
      dashboardRequest.current++;
      incidentRequest.current++;
    };
  }, [fetchDashboard]);

  useEffect(() => {
    if (currentTab === "incidents") void fetchIncidents();
  }, [currentTab, fetchIncidents]);

  useEffect(() => {
    let disposed = false;
    let healthy = false;
    let revision = "";
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource;
    let lastReconciliation = Date.now();
    const reconcile = () => {
      lastReconciliation = Date.now();
      void fetchDashboard();
      if (currentTabRef.current === "incidents") void fetchIncidents();
    };
    const schedule = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        reconcile();
      }, 100);
    };
    const connect = () => {
      if (disposed) return;
      source = new EventSource("/api/v1/events/stream");
      source.onopen = () => {
        healthy = true;
        setSseConnected(true);
        schedule();
      };
      source.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "HEARTBEAT") return;
          if (event.lastEventId && event.lastEventId === revision) return;
          revision = event.lastEventId;
          schedule();
        } catch {
          healthy = false;
          setSseConnected(false);
        }
      };
      source.onerror = () => {
        healthy = false;
        setSseConnected(false);
        source.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    const timer = setInterval(() => {
      if (!healthy || Date.now() - lastReconciliation >= 15000) reconcile();
    }, 5000);
    return () => {
      disposed = true;
      source?.close();
      clearInterval(timer);
      clearTimeout(retry);
      clearTimeout(debounce);
    };
  }, [fetchDashboard, fetchIncidents]);

  // Changing accounts requires signing in again.
  const handleSwitchUser = async () => {
    setSessionError(null);
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok)
        throw new Error("Could not sign out. Please try again.");
      setCurrentUser({ username: "Guest", role: "OPERATOR", token: "" });
    } catch {
      setSessionError(
        "Could not sign out. Check the API connection and try again.",
      );
    }
  };

  // Actions
  const handleTriggerFailure = async (type: DemoScenarioId) => {
    const res = await fetch("/api/v1/demo/failures", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({ type }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to trigger fault");
    }
    await fetchDashboard();
  };

  const handleResetDemo = async () => {
    const res = await fetch("/api/v1/demo/reset", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${currentUser.token}`,
      },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to reset demo");
    }
    await fetchDashboard();
    await fetchIncidents();
  };

  const handleApproveRunbook = async (
    incidentId: string,
    runbookId: string,
  ) => {
    const res = await fetch(`/api/v1/incidents/${incidentId}/approve-runbook`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        runbook_id: runbookId,
        justification:
          "Approved by demo administrator following manual verification",
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to approve runbook");
    }
    await fetchDashboard();
  };

  const handleRejectRunbook = async (incidentId: string, runbookId: string) => {
    const res = await fetch(`/api/v1/incidents/${incidentId}/reject-runbook`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        runbook_id: runbookId,
        justification:
          "Refused by administrator: unsafe condition or unknown root cause",
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to reject runbook");
    }
    await fetchDashboard();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        currentUser={currentUser}
        onSwitchUser={handleSwitchUser}
        sseConnected={sseConnected}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-8 py-6 lg:py-9"
      >
        {sessionError && (
          <p role="alert" className="mb-4 text-sm text-stone-700">
            {sessionError}
          </p>
        )}
        {!currentUser.token && (
          <SignIn
            onSignIn={loginUser}
            onStartDemo={async () => {
              const response = await fetch("/api/v1/auth/demo", {
                method: "POST",
                signal: AbortSignal.timeout(20000),
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.detail || "Could not start demo session.",
                );
              setCurrentUser({
                username: result.user.username,
                role: result.user.role,
                token: result.access_token,
              });
              setCurrentTab("demo");
              window.scrollTo({ top: 0, behavior: "auto" });
            }}
          />
        )}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <p role="status">
            {dashboardError
              ? "Updates unavailable  /  Displayed data may be out of date"
              : lastUpdated
                ? `Last updated ${new Date(lastUpdated).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour12: false })} MYT`
                : "Connecting to service data..."}
          </p>
          <button
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await Promise.all([fetchDashboard(), fetchIncidents()]);
              } finally {
                setRefreshing(false);
              }
            }}
            className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? (
              <span className="inline-flex items-center gap-2">
                <ActivityIndicator className="!h-3 !w-3" />
                Refreshing...
              </span>
            ) : (
              "Refresh data"
            )}
          </button>
        </div>
        {dashboardError && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-stone-300/30 bg-stone-100/10 p-4 text-sm text-stone-900"
          >
            {dashboardError} Automatic retries continue every 5 seconds.
          </div>
        )}
        <div key={currentTab} className="view-enter">
          {currentTab === "overview" && (
            <OverviewView
              data={dashboardData}
              loadError={dashboardError}
              currentUser={currentUser}
              onRefresh={fetchDashboard}
              onApproveRunbook={handleApproveRunbook}
              onRejectRunbook={handleRejectRunbook}
              onTriggerFailure={handleTriggerFailure}
              onResetDemo={handleResetDemo}
              onNavigate={setCurrentTab}
            />
          )}

          {currentTab === "incidents" && (
            <IncidentsView
              incidents={incidents}
              error={incidentsError}
              loading={!incidentsLoaded && !incidentsError}
              onRetry={fetchIncidents}
            />
          )}

          {currentTab === "audit" && (
            <AuditView events={dashboardData?.recent_events || []} />
          )}

          {currentTab === "demo" && (
            <DemoControlsView
              dataStale={!!dashboardError}
              data={dashboardData}
              currentUser={currentUser}
              onTriggerFailure={handleTriggerFailure}
              onResetDemo={handleResetDemo}
            />
          )}

          {currentTab === "settings" && (
            <SettingsView
              currentUser={currentUser}
              metrics={dashboardData?.metrics}
            />
          )}
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Rebound / Hackathon prototype</span>
          <span>Simulated services only / No production connection</span>
        </div>
      </footer>
    </div>
  );
}
