"use client";

import React, { FormEvent, useState } from "react";
import ActivityIndicator from "./ActivityIndicator";

export default function SignIn({
  onSignIn,
  onStartDemo,
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
  onStartDemo: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await onSignIn(
        String(fields.get("username") || ""),
        String(fields.get("password") || ""),
      );
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ui-panel mb-5 p-4 sm:p-5" aria-label="Operator sign-in">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">
            Explore the sandbox
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            Read-only until you start a session.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onStartDemo();
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Could not start demo.",
              );
            } finally {
              setBusy(false);
            }
          }}
          className="ui-button ui-button-primary shrink-0"
        >
          {busy ? (
            <>
              <ActivityIndicator className="!h-4 !w-4" />
              Starting...
            </>
          ) : (
            "Start local demo"
          )}
        </button>
      </div>
      <details className="mt-2 text-xs text-stone-600">
        <summary className="cursor-pointer">
          Account access for other deployments
        </summary>
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-stone-500">
            Username
            <input
              name="username"
              autoComplete="username"
              required
              className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900"
            />
          </label>
          <label className="text-xs text-stone-500">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900"
            />
          </label>
          <button
            disabled={busy}
            className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-on-primary disabled:opacity-50"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </details>
      {error && (
        <p role="alert" className="ui-notice mt-3">
          {error}
        </p>
      )}
    </section>
  );
}
