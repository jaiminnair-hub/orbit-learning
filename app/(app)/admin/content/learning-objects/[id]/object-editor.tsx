"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WorkflowBar, VersionHistory } from "../../ui";

interface LearningObject {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  version: number;
}
interface AttachedAsset {
  assetId: string;
  type: string;
  url: string;
}
interface LibraryAsset {
  id: string;
  type: string;
  storage_path: string;
}

const KINDS = ["content", "knowledge_check", "assignment", "scenario"];

export function ObjectEditor({ objectId }: { objectId: string }) {
  const [object, setObject] = useState<LearningObject | null>(null);
  const [attached, setAttached] = useState<AttachedAsset[]>([]);
  const [scorm, setScorm] = useState<{ packageId: string; entryPoint: string } | null>(null);
  const [library, setLibrary] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("content");
  const [pick, setPick] = useState("");

  const load = useCallback(async () => {
    const [oRes, aRes, lRes] = await Promise.all([
      fetch(`/api/v1/content/learning-objects/${objectId}`),
      fetch(`/api/v1/content/learning-objects/${objectId}/assets`),
      fetch("/api/v1/content/assets"),
    ]);
    if (!oRes.ok) {
      setError("This learning object could not be loaded.");
      setLoading(false);
      return;
    }
    const o = (await oRes.json()).data.learningObject as LearningObject;
    setObject(o);
    setTitle(o.title);
    setDescription(o.description ?? "");
    setKind(o.kind);
    if (aRes.ok) {
      const d = (await aRes.json()).data;
      setAttached(d.assets);
      setScorm(d.scorm);
    }
    if (lRes.ok) setLibrary((await lRes.json()).data.assets);
    setLoading(false);
  }, [objectId]);

  // Initial fetch is inlined rather than calling load(): the react-hooks
  // lint rule traces setState through a called function, so the same
  // inline-IIFE shape used elsewhere in this app is what satisfies it.
  // load() stays for imperative refreshes after a mutation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Same try/finally reasoning as the course editor: a parsing
      // failure must not strand the page on "Loading…".
      try {
        const [oRes, aRes, lRes] = await Promise.all([
          fetch(`/api/v1/content/learning-objects/${objectId}`),
          fetch(`/api/v1/content/learning-objects/${objectId}/assets`),
          fetch("/api/v1/content/assets"),
        ]);
        if (cancelled) return;
        if (!oRes.ok) {
          setError("This learning object could not be loaded.");
          return;
        }
        const o = (await oRes.json()).data.learningObject as LearningObject;
        if (cancelled) return;
        setObject(o);
        setTitle(o.title);
        setDescription(o.description ?? "");
        setKind(o.kind);
        if (aRes.ok) {
          const d = (await aRes.json()).data;
          if (!cancelled) {
            setAttached(d.assets);
            setScorm(d.scorm);
          }
        }
        if (lRes.ok) {
          const lib = await lRes.json();
          if (!cancelled) setLibrary(lib.data.assets);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load this learning object.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectId]);

  async function save() {
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/v1/content/learning-objects/${objectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null, kind }),
    });
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not save.");
      return;
    }
    setSaved(true);
    await load();
  }

  async function attach() {
    if (!pick) return;
    setError(null);
    const res = await fetch(`/api/v1/content/learning-objects/${objectId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentAssetId: pick }),
    });
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not attach.");
      return;
    }
    setPick("");
    await load();
  }

  async function detach(assetId: string) {
    setError(null);
    const res = await fetch(
      `/api/v1/content/learning-objects/${objectId}/assets?contentAssetId=${assetId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not detach.");
      return;
    }
    await load();
  }

  if (loading) return <div className="studio-editor__loading">Opening learning object…</div>;
  if (!object) return <p className="studio-console__message studio-console__message--error">{error ?? "Not found."}</p>;

  const attachedIds = new Set(attached.map((a) => a.assetId));

  return (
    <div className="studio-editor">
      <p className="studio-editor__back">
        <Link href="/admin/content/learning-objects">← All learning objects</Link>
      </p>

      <header className="studio-editor__heading"><div><p>Learning object studio</p><h1>{object.title}</h1><span>Define the reusable building block and connect the material it needs to deliver.</span></div><div className="studio-editor__meta"><span>v{object.version}</span></div></header>

      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}

      <WorkflowBar
        status={object.status}
        publishUrl={`/api/v1/content/learning-objects/${objectId}/publish`}
        onChanged={() => {
          void load();
          setRefreshKey((k) => k + 1);
        }}
      />

      <section className="studio-editor__section">
        <header><p>01 · Definition</p><h2>Object details</h2></header>
        <div className="studio-editor__details">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button onClick={save}>Save details</button>
            {saved && <span className="studio-editor__saved">Saved</span>}
          </div>
        </div>
      </section>

      <section className="studio-editor__section studio-object-editor">
        <header><p>02 · Source material</p><h2>Attached content</h2></header>

        {scorm && (
          <p className="studio-object-editor__scorm">
            SCORM package attached — entry point <code>{scorm.entryPoint}</code>. The player runs it
            in a sandboxed frame.
          </p>
        )}

        {attached.length === 0 && !scorm ? (
          <p className="studio-editor__empty">
            Nothing attached yet. A learning object with no content will render as an empty item in
            the player.
          </p>
        ) : (
          <ul className="studio-object-editor__assets">
            {attached.map((a) => (
              <li key={a.assetId}>
                <span>{a.type}</span><a href={a.url} target="_blank" rel="noopener noreferrer">
                  open
                </a>
                <button onClick={() => detach(a.assetId)}>
                  Detach
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="studio-object-editor__attach">
          <label>
            Attach from the content library
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Select an uploaded file…</option>
              {library
                .filter((a) => !attachedIds.has(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    [{a.type}] {a.storage_path.split("/").slice(1).join("/")}
                  </option>
                ))}
            </select>
          </label>
          <button onClick={attach} disabled={!pick}>
            Attach
          </button>
          <Link href="/admin/content/assets">
            Upload something new →
          </Link>
        </div>
      </section>

      <VersionHistory entityType="learning_object" entityId={objectId} refreshKey={refreshKey} />
    </div>
  );
}
