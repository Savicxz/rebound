"use client";

import React from "react";
import { User } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  currentUser: { username: string; role: string };
  onSwitchUser: () => void;
  sseConnected: boolean;
}

export default function Navbar({
  currentTab,
  setCurrentTab,
  currentUser,
  onSwitchUser,
  sseConnected,
}: NavbarProps) {
  const items = [
    { id: "overview", label: "Service watch" },
    { id: "incidents", label: "Incidents" },
    { id: "audit", label: "Audit trail" },
    { id: "demo", label: "Scenarios" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-5 sm:px-8">
        <div className="flex min-h-16 items-center gap-3">
          <p className="flex items-center text-base font-semibold tracking-tight text-stone-900">
            <span
              aria-hidden="true"
              className="mr-3 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs text-on-primary"
            >
              R
            </span>
            Rebound
            <span className="ml-3 text-xs font-normal text-stone-500">
              / sandbox
            </span>
          </p>
        </div>
        <nav
          aria-label="Main navigation"
          className="order-3 flex w-full gap-5 overflow-x-auto sm:gap-7 lg:order-none lg:w-auto"
        >
          {items.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setCurrentTab(id)}
              aria-current={currentTab === id ? "page" : undefined}
              className={`relative min-h-12 shrink-0 border-b-2 px-1 py-3 text-[13px] lg:min-h-16 ${currentTab === id ? "border-stone-900 font-semibold text-stone-900" : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-900"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-stone-500"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full border border-stone-600 ${sseConnected ? "bg-stone-800" : "bg-transparent"}`}
            />
            <span className="sr-only sm:not-sr-only">
              {sseConnected ? "Live updates" : "Polling / reconnecting"}
            </span>
          </p>
          <button
            onClick={onSwitchUser}
            aria-label={`Sign out or switch account. Current user: ${currentUser.username}`}
            className="flex min-h-11 items-center gap-2 text-xs text-stone-700 hover:text-stone-950"
          >
            <User aria-hidden="true" className="h-3.5 w-3.5" />
            {currentUser.username === "Guest"
              ? "Guest"
              : `${currentUser.username} / Sign out`}
          </button>
        </div>
      </div>
      <p className="sr-only">Not connected to live systems.</p>
    </header>
  );
}
