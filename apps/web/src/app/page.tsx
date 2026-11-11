"use client";

import React, { useState, useEffect, useCallback } from "react";
import Navbar from "../components/Navbar";
import OverviewView from "../components/OverviewView";
import IncidentsView from "../components/IncidentsView";
import AuditView from "../components/AuditView";
import DemoControlsView from "../components/DemoControlsView";
import SettingsView from "../components/SettingsView";
import SignIn from "../components/SignIn";
import { DashboardData, Incident } from "../types";

export default function Home() {
  const [currentTab, setCurrentTab] = useState("overview");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [incidents, setIncidents] = useState<Incident[]>([]);
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
    setRefreshing(true);
    try {
      const res = await fetch("/api/v1/dashboard", {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Dashboard returned HTTP ${res.status}`);
      const data: DashboardData = await res.json();
      setDashboardData(data);
      setLastUpdated(new Date().toISOString());
      setDashboardError(null);
    } catch (e) {
      setDashboardError(
        "Unable to refresh service data. Check that the API is running and try again.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Fetch Incidents List
  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/incidents");
      if (res.ok) {
        const data: Incident[] = await res.json();
        setIncidents(data);
      }
    } catch (e) {
      console.error("Incidents fetch error:", e);
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
      }
    };

    connectSSE();

    // Fallback polling every 5 seconds to ensure UI is never stale
    fallbackTimer = setInterval(() => {
      fetchDashboard();
      if (currentTab === "incidents") {
        fetchIncidents();
      }
    }, 5000);

    return () => {
      disposed = true;
      eventSource?.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [fetchDashboard, fetchIncidents, currentTab]);

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
  const handleTriggerFailure = async (type: "crash" | "degraded") => {
    const res = await fetch("/api/v1/demo/failures", {
      method: "POST",
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
        className="flex-1 max-w-[1120px] w-full mx-auto px-5 sm:px-8 py-5 lg:py-6"
      >
        {sessionError && (
          <p role="alert" className="mb-4 text-sm text-rose-700">
            {sessionError}
          </p>
        )}
        {!currentUser.token && <SignIn onSignIn={loginUser} />}
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3 pb-2 text-xs text-slate-500">
          <p role="status">
            {dashboardError
              ? "Updates unavailable Â· Displayed data may be out of date"
              : lastUpdated
                ? `Last updated ${new Date(lastUpdated).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour12: false })} MYT`
                : "Connecting to service dataâ€¦"}
          </p>
          <button
            disabled={refreshing}
            onClick={fetchDashboard}
            className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? "Refreshingâ€¦" : "Refresh data"}
          </button>
        </div>
        {dashboardError && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800"
          >
            {dashboardError} Automatic retries continue every 5 seconds.
          </div>
        )}
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

        {currentTab === "incidents" && <IncidentsView incidents={incidents} />}

        {currentTab === "audit" && (
          <AuditView events={dashboardData?.recent_events || []} />
        )}

        {currentTab === "demo" && (
          <DemoControlsView
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
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Rebound Â· Hackathon prototype</span>
          <span>Simulated services only Â· No production connection</span>
        </div>
      </footer>
    </div>
  );
}
