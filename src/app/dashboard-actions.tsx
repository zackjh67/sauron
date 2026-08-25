"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_MODEL = "claude-sonnet-5";
const MODELS = [
  { value: DEFAULT_MODEL, label: "Sonnet 5 (default)" },
  { value: "claude-opus-5", label: "Opus 5" },
];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function useApiAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(input: RequestInfo, init?: RequestInit) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(input, init);
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      router.refresh();
    });
  }

  return { run, pending, error };
}

/** Shared by RunButton and RerunButton — a model/effort pair plus a submit button. */
function ModelEffortControls({ endpoint, label }: { endpoint: string; label: string }) {
  const { run, pending, error } = useApiAction();
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState("medium");

  return (
    <span className="run-controls">
      <select value={model} onChange={(e) => setModel(e.target.value)} disabled={pending} aria-label="Model">
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={pending} aria-label="Effort">
        {EFFORTS.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <button
        className="primary"
        disabled={pending}
        onClick={() =>
          run(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model, effort }),
          })
        }
      >
        {pending ? "Starting…" : label}
      </button>
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}

export function RunButton({ id }: { id: string }) {
  return <ModelEffortControls endpoint={`/api/investigations/${id}/run`} label="Run now" />;
}

export function RerunButton({ id }: { id: string }) {
  return <ModelEffortControls endpoint={`/api/investigations/${id}/rerun`} label="Re-run" />;
}

export function DiscardButton({ id }: { id: string }) {
  const { run, pending, error } = useApiAction();
  return (
    <span>
      <button className="danger" disabled={pending} onClick={() => run(`/api/investigations/${id}/discard`, { method: "POST" })}>
        {pending ? "…" : "Discard"}
      </button>
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}

export function PauseToggle({ paused }: { paused: boolean }) {
  const { run, pending, error } = useApiAction();
  return (
    <span>
      <button
        className={paused ? "primary" : "danger"}
        disabled={pending}
        onClick={() =>
          run("/api/settings/pause", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ paused: !paused }),
          })
        }
      >
        {pending ? "…" : paused ? "Resume" : "Pause"}
      </button>
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}
