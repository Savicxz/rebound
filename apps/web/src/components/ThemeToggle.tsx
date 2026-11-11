"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "light");
  }, []);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("rebound-theme", next);
    } catch {
      /* Theme still works when storage is unavailable. */
    }
  }
  return (
    <button
      onClick={toggle}
      aria-pressed={theme === "dark"}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      className="flex min-h-11 items-center gap-2 text-xs text-stone-700 hover:text-stone-950"
    >
      {theme === "light" ? (
        <Moon aria-hidden="true" className="h-4 w-4" />
      ) : (
        <Sun aria-hidden="true" className="h-4 w-4" />
      )}
      <span>{theme === "light" ? "Dark" : "Light"}</span>
    </button>
  );
}
