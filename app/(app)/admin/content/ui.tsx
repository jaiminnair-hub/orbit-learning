"use client";

import { useCallback, useEffect, useState } from "react";

// Shared bits for the authoring screens. Kept deliberately plain — this
// is the UI layer over Phase 2's existing API, not a design system.
// A real design system is a separate, later investment
// (docs/DESIGN_SYSTEM.md).

export const card = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 16,
  background: "#fff",
} as const;

export const errorBox = {
  color: "#b23a3a",
  background: "#faeae8",
  padding: 10,
  borderRadius: 6,
} as const;

export const STATUSES = ["draft", "review", "approval", "published", "archived"] as const;
export type Status = (typeof STATUSES)[number];

// Mirrors lib/content/publish.ts's state machine so the UI only offers
// transitions the server will actually accept. The server remains the
// authority — this just avoids showing buttons that would 409.
const NEXT: Record<string, Status[]> = {
  draft: ["review", "archived"],
  review: ["approval", "draft", "archived"],
  approval: ["published", "draft", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    draft: ["#5b6478", "#eceef2"],
    review: ["#96660e", "#fbf0da"],
    approval: ["#17406f", "#e7eef8"],
    published: ["#227a53", "#e3f3ea"],
    archived: ["#5b6478", "#eceef2"],
  };
  const [fg, bg] = colors[status] ?? colors.draft;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        borderRadius: 20,
        padding: "2px 10px",
        fontSize: ".72rem",
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

// The draft → review → approval → published → archived control, shared by
// the course and learning-object editors because both use the same
// server-side state machine.
export function WorkflowBar({
  status,
  publishUrl,
  onChanged,
}: {
  status: string;
  publishUrl: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: Status) {
    setBusy(true);
    setError(null);
    // try/finally so a rejected fetch or a non-JSON body can never leave
    // every transition button permanently disabled — which is exactly
    // what happened before this guard existed.
    try {
      const res = await fetch(publishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error?.message ?? `Could not change status (${res.status}).`);
        return;
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const options = NEXT[status] ?? [];

  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: ".85rem" }}>Workflow</strong>
        <StatusPill status={status} />
        {options.length === 0 && <span style={{ fontSize: ".8rem", color: "#555" }}>No further transitions.</span>}
        {options.map((to) => (
          <button key={to} onClick={() => move(to)} disabled={busy}>
            {to === "published" ? "Publish" : `Move to ${to}`}
          </button>
        ))}
      </div>
      <p style={{ fontSize: ".76rem", color: "#666", margin: "8px 0 0" }}>
        Publishing writes an immutable version snapshot. Editing a published item starts a fresh
        draft on top of it — the live version keeps serving until the next publish.
      </p>
      {error && <p style={{ ...errorBox, marginTop: 10 }}>{error}</p>}
    </div>
  );
}

interface Version {
  id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  published_at: string;
}
interface Review {
  decision: string;
  comments: string | null;
  reviewed_at: string;
}

// Reads the immutable publish snapshots plus the workflow audit trail.
export function VersionHistory({
  entityType,
  entityId,
  refreshKey,
}: {
  entityType: "course" | "learning_object";
  entityId: string;
  refreshKey: number;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/v1/content/versions?entityType=${entityType}&entityId=${entityId}`
    );
    if (!res.ok) return;
    const json = await res.json();
    setVersions(json.data.versions);
    setReviews(json.data.reviews);
  }, [entityType, entityId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/v1/content/versions?entityType=${entityType}&entityId=${entityId}`
      );
      if (!res.ok || cancelled) return;
      const json = await res.json();
      if (cancelled) return;
      setVersions(json.data.versions);
      setReviews(json.data.reviews);
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, refreshKey]);

  return (
    <section style={card}>
      <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Version history</h3>
      {versions.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "#555" }}>
          No published versions yet. A snapshot is written each time this is published.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {versions.map((v) => (
            <li key={v.id} style={{ borderTop: "1px solid #eee", padding: "8px 0" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <strong style={{ fontSize: ".85rem" }}>v{v.version_number}</strong>
                <span style={{ fontSize: ".78rem", color: "#666" }}>
                  {new Date(v.published_at).toLocaleString()}
                </span>
                <button
                  onClick={() => setOpen(open === v.id ? null : v.id)}
                  style={{ fontSize: ".75rem" }}
                >
                  {open === v.id ? "Hide" : "View snapshot"}
                </button>
              </div>
              {open === v.id && (
                <pre
                  style={{
                    background: "#f6f7f9",
                    padding: 10,
                    borderRadius: 6,
                    fontSize: ".72rem",
                    overflowX: "auto",
                    marginTop: 8,
                  }}
                >
                  {JSON.stringify(v.snapshot, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      {reviews.length > 0 && (
        <>
          <h4 style={{ fontSize: ".85rem", marginBottom: 4 }}>Workflow trail</h4>
          <ul style={{ fontSize: ".78rem", color: "#555", paddingLeft: 18, margin: 0 }}>
            {reviews.map((r, i) => (
              <li key={i}>
                {r.decision} — {new Date(r.reviewed_at).toLocaleString()}
                {r.comments ? ` — ${r.comments}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      <button onClick={load} style={{ marginTop: 10, fontSize: ".75rem" }}>
        Refresh
      </button>
    </section>
  );
}
