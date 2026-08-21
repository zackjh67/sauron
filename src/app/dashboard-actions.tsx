"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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

export function RunButton({ id }: { id: string }) {
  const { run, pending, error } = useApiAction();
  return (
    <span>
      <button disabled={pending} onClick={() => run(`/api/investigations/${id}/run`, { method: "POST" })}>
        {pending ? "Starting…" : "Run now"}
      </button>
      {error && <span className="error"> {error}</span>}
    </span>
  );
}

export function DiscardButton({ id }: { id: string }) {
  const { run, pending, error } = useApiAction();
  return (
    <span>
      <button disabled={pending} onClick={() => run(`/api/investigations/${id}/discard`, { method: "POST" })}>
        {pending ? "…" : "Discard"}
      </button>
      {error && <span className="error"> {error}</span>}
    </span>
  );
}

export function PauseToggle({ paused }: { paused: boolean }) {
  const { run, pending, error } = useApiAction();
  return (
    <span>
      <button
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
      {error && <span className="error"> {error}</span>}
    </span>
  );
}
