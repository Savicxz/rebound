"use client";

import React, { FormEvent, useState } from "react";

export default function SignIn({
  onSignIn,
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
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
    <section
      className="mb-6 rounded-md border border-stone-200 bg-white p-4"
      aria-label="Operator sign-in"
    >
      <h2 className="text-sm font-semibold text-stone-900">
        Sign in to control the sandbox
      </h2>
      <p className="mt-1 text-xs text-stone-500">
        Service data is read-only until you sign in. Use an administrator
        account to approve recovery.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-stone-500">
          Username
          <input
            name="username"
            autoComplete="username"
            required
            className="mt-1 block rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900"
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
          className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
