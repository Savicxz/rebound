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

  // Fetch Dashboard Telemetry
  const fetchDashboard = useCallback(async () => {
    const request = ++dashboardRequest.current;
    try {
      const res = await fetch("/api/v1/dashboard", {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Dashboard returned HTTP ${res.status}`);
      const data: DashboardData = await res.json();
      if (request !== dashboardRequest.current) return;
      setDashboardData(data);
      setLastUpdated(new Date().toISOString());
      setDashboardError(null);
    } catch (e) {
      if (request !== dashboardRequest.current) return;
      setDashboardError(
        "Unable to refresh service data. Check that the API is running and try again.",
      );
    }
  }, []);

  // Fetch Incidents List
  const fetchIncidents = useCallback(async () => {
    const request = ++incidentRequest.current;
    try {
      const res = await fetch("/api/v1/incidents", {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("Incident history unavailable");
      if (res.ok) {
        const data: Incident[] = await res.json();
        if (request !== incidentRequest.current) return;
        setIncidents(data);
        setIncidentsError(null);
        setIncidentsLoaded(true);
      }
    } catch (e) {
      if (request === incidentRequest.current)
        setIncidentsError(
          "Incident history could not be refreshed. Existing records may be stale.",
        );
    }
  }, []);

  // Initial load & seed login
  useEffect(() => {
    fetchDashboard();
    fetchIncidents();
  }, [loginUser, fetchDashboard, fetchIncidents]);

  // Real-time Server-Sent Events (SSE) Stream
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connectSSE = () => {
      if (disposed) return;
      try {
        eventSource = new EventSource("/api/v1/events/stream");

        eventSource.onopen = () => {
          setSseConnected(true);
        };

        eventSource.onmessage = (e) => {
          try {
            const parsed = JSON.parse(e.data);
            if (parsed.type !== "HEARTBEAT") {
              fetchDashboard();
              fetchIncidents();
            }
          } catch (err) {
            console.error("SSE parse error:", err);
          }
        };

        eventSource.onerror = () => {
          setSseConnected(false);
          eventSource?.close();
          // Retry connection after 5 seconds
          retryTimer = setTimeout(connectSSE, 5000);
        };
      } catch (err) {
        setSseConnected(false);
        retryTimer = setTimeout(connectSSE, 5000);
      }
    };

    connectSSE();

    // Fallback polling every 5 seconds to ensure UI is never stale
    fallbackTimer = setInterval(() => {
      fetchDashboard();
      if (currentTabRef.current === "incidents") {
        fetchIncidents();
      }
    }, 5000);

    return () => {
      disposed = true;
      eventSource?.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (retryTimer) clearTimeout(retryTimer);
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
