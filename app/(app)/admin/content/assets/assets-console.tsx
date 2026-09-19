"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusPill } from "../ui";

interface Asset {
  id: string;
  type: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  status: string;
  created_at: string;
}
interface ScormPackage {
  id: string;
  title: string;
  scorm_version: string;
  entry_point: string;
  content_asset_id: string;
  status: string;
}
interface XapiPackage {
  id: string;
  title: string;
  activity_id: string;
  launch_path: string;
  content_asset_id: string;
  status: string;
}

const ASSET_TYPES = ["pdf", "video", "audio", "ppt", "document", "text", "url", "embed"];
// Supabase Free projects enforce a 50 MB global maximum, regardless of
// bucket-specific settings. Keep this client-side guard aligned so authors
// get an honest answer before a direct Storage upload starts.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function uploadContentType(file: File): string {
  // Some browsers leave File.type blank for otherwise valid media. Use a
  // conservative extension fallback which mirrors the Storage allowlist.
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
  }[extension ?? ""] ?? "application/octet-stream";
}

function uploadError(status: number, detail: string): string {
  if (status === 413 || /size|large/i.test(detail)) {
    return "This file exceeds Supabase Free's 50 MB upload limit. Compress it below 50 MB or move video delivery to a dedicated video service.";
  }
  if (/mime|type|format/i.test(detail)) {
    return "This file format is not supported. For video, use MP4, WebM, MOV, or M4V.";
  }
  return `Storage rejected the upload (${status}). ${detail || "Please try again."}`;
}

function prettySize(bytes: number | null) {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Uploads run through the real two-step signed-URL flow (Phase 2 step 1):
// ask the server for a signed URL, PUT the bytes straight to Storage,
// then confirm so the row is only created once the object actually
// landed. The browser never gets bucket credentials.
export function AssetsConsole() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [packages, setPackages] = useState<ScormPackage[]>([]);
  const [xapiPackages, setXapiPackages] = useState<XapiPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("pdf");
  const [busy, setBusy] = useState(false);

  const [scormFile, setScormFile] = useState<File | null>(null);
  const [scormBusy, setScormBusy] = useState(false);

  const [xapiFile, setXapiFile] = useState<File | null>(null);
  const [xapiBusy, setXapiBusy] = useState(false);

  const load = useCallback(async () => {
    const [aRes, sRes, xRes] = await Promise.all([
      fetch("/api/v1/content/assets"),
      fetch("/api/v1/content/scorm"),
      fetch("/api/v1/content/xapi"),
    ]);
    if (aRes.ok) setAssets((await aRes.json()).data.assets);
    if (sRes.ok) setPackages((await sRes.json()).data.packages);
    if (xRes.ok) setXapiPackages((await xRes.json()).data.packages);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aRes, sRes, xRes] = await Promise.all([
        fetch("/api/v1/content/assets"),
        fetch("/api/v1/content/scorm"),
        fetch("/api/v1/content/xapi"),
      ]);
      if (cancelled) return;
      if (aRes.ok) setAssets((await aRes.json()).data.assets);
      if (sRes.ok) setPackages((await sRes.json()).data.packages);
      if (xRes.ok) setXapiPackages((await xRes.json()).data.packages);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Shared by both upload forms — the flow is identical, only the
  // declared type and the follow-up registration differ.
  async function uploadThroughSignedUrl(f: File, assetType: string) {
    if (f.size > MAX_UPLOAD_BYTES) {
      throw new Error("This file exceeds Supabase Free's 50 MB upload limit. Compress it below 50 MB or move video delivery to a dedicated video service.");
    }

    const contentType = uploadContentType(f);
    const urlRes = await fetch("/api/v1/content/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: f.name }),
    });
    if (!urlRes.ok) throw new Error((await urlRes.json()).error?.message ?? "Could not start upload.");
    const { data } = await urlRes.json();

    const put = await fetch(data.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: f,
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => "");
      throw new Error(uploadError(put.status, detail));
    }

    const confirm = await fetch("/api/v1/content/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath: data.path,
        type: assetType,
        mimeType: contentType,
        fileSize: f.size,
      }),
    });
    if (!confirm.ok) throw new Error((await confirm.json()).error?.message ?? "Could not save the asset.");
    return (await confirm.json()).data.asset as Asset;
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const asset = await uploadThroughSignedUrl(file, type);
      setNotice(`Uploaded ${file.name} as ${asset.type}.`);
      setFile(null);
      const el = document.getElementById("asset-file") as HTMLInputElement | null;
      if (el) el.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleScorm(event: FormEvent) {
    event.preventDefault();
    if (!scormFile) return;
    setScormBusy(true);
    setError(null);
    setNotice(null);
    try {
      const asset = await uploadThroughSignedUrl(scormFile, "scorm");
      // Registration extracts the zip server-side and reads
      // imsmanifest.xml — the client never parses the package.
      const reg = await fetch("/api/v1/content/scorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentAssetId: asset.id }),
      });
      if (!reg.ok) {
        throw new Error((await reg.json()).error?.message ?? "Could not register the SCORM package.");
      }
      const { data } = await reg.json();
      setNotice(`Registered "${data.package.title}" (SCORM ${data.package.scorm_version}, ${data.fileCount} files).`);
      setScormFile(null);
      const el = document.getElementById("scorm-file") as HTMLInputElement | null;
      if (el) el.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "SCORM upload failed.");
    } finally {
      setScormBusy(false);
    }
  }

  async function handleXapi(event: FormEvent) {
    event.preventDefault();
    if (!xapiFile) return;
    setXapiBusy(true);
    setError(null);
    setNotice(null);
    try {
      const asset = await uploadThroughSignedUrl(xapiFile, "xapi");
      // Registration extracts the zip server-side and reads tincan.xml —
      // the client never parses the package.
      const reg = await fetch("/api/v1/content/xapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentAssetId: asset.id }),
      });
      if (!reg.ok) {
        throw new Error((await reg.json()).error?.message ?? "Could not register the xAPI package.");
      }
      const { data } = await reg.json();
      setNotice(`Registered "${data.package.title}" (xAPI, ${data.fileCount} files).`);
      setXapiFile(null);
      const el = document.getElementById("xapi-file") as HTMLInputElement | null;
      if (el) el.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "xAPI upload failed.");
    } finally {
      setXapiBusy(false);
    }
  }

  if (loading) return <div className="studio-console__loading">Preparing your content library…</div>;

  return (
    <div className="studio-console">
      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}
      {notice && <p className="studio-console__message studio-console__message--success">{notice}</p>}

      <section className="studio-console__action-card">
        <div><p>01 · Source material</p><h2>Upload a content asset.</h2><span>Video, audio, documents, slides and images can become reusable learning material. On the Free plan, each file must be under 50 MB.</span></div>
        <form onSubmit={handleUpload}>
          <label>
            File
            <input
              id="asset-file"
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-m4v,audio/mpeg,audio/wav,audio/ogg,application/pdf,.doc,.docx,.ppt,.pptx,.txt,.zip,image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!file || busy}>{busy ? "Uploading…" : "Add to library →"}</button>
        </form>
      </section>

      <section className="studio-console__action-card studio-console__action-card--scorm">
        <div><p>02 · Structured courseware</p><h2>Import a SCORM package.</h2><span>Upload a SCORM 1.2 or 2004 ZIP. Orbit extracts it safely, reads its manifest, and makes it available to a learning object.</span></div>
        <form onSubmit={handleScorm}>
          <label>
            SCORM .zip
            <input
              id="scorm-file"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setScormFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" disabled={!scormFile || scormBusy}>{scormBusy ? "Uploading & extracting…" : "Import SCORM →"}</button>
        </form>
      </section>

      <section className="studio-console__action-card studio-console__action-card--scorm">
        <div><p>03 · Structured courseware</p><h2>Import an xAPI (Tin Can) package.</h2><span>Upload a Tin Can ZIP containing a tincan.xml. Orbit extracts it safely, reads its manifest, and makes it available to a learning object — it launches against Orbit acting as the LRS.</span></div>
        <form onSubmit={handleXapi}>
          <label>
            xAPI .zip
            <input
              id="xapi-file"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setXapiFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" disabled={!xapiFile || xapiBusy}>{xapiBusy ? "Uploading & extracting…" : "Import xAPI →"}</button>
        </form>
      </section>

      <section className="studio-console__section">
        <header><div><p>Library record</p><h2>SCORM packages</h2></div><span>{packages.length} packages</span></header>
        {packages.length === 0 ? (
          <p className="studio-console__empty">No SCORM packages yet.</p>
        ) : (
          <div className="studio-console__table-wrap"><table className="studio-console__table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Title</th>
                <th style={{ textAlign: "left" }}>Version</th>
                <th style={{ textAlign: "left" }}>Entry point</th>
                <th style={{ textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>SCORM {p.scorm_version}</td>
                  <td>
                    <code>{p.entry_point}</code>
                  </td>
                  <td>
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="studio-console__section">
        <header><div><p>Library record</p><h2>xAPI packages</h2></div><span>{xapiPackages.length} packages</span></header>
        {xapiPackages.length === 0 ? (
          <p className="studio-console__empty">No xAPI packages yet.</p>
        ) : (
          <div className="studio-console__table-wrap"><table className="studio-console__table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Title</th>
                <th style={{ textAlign: "left" }}>Activity id</th>
                <th style={{ textAlign: "left" }}>Launch path</th>
                <th style={{ textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {xapiPackages.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td style={{ wordBreak: "break-all" }}>
                    <code>{p.activity_id}</code>
                  </td>
                  <td>
                    <code>{p.launch_path}</code>
                  </td>
                  <td>
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="studio-console__section">
        <header><div><p>Library record</p><h2>Content assets</h2></div><span>{assets.length} items</span></header>
        {assets.length === 0 ? (
          <p className="studio-console__empty">Nothing uploaded yet. Begin with material you already trust.</p>
        ) : (
          <div className="studio-console__table-wrap"><table className="studio-console__table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>File</th>
                <th style={{ textAlign: "left" }}>Type</th>
                <th style={{ textAlign: "left" }}>Size</th>
                <th style={{ textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td style={{ wordBreak: "break-all" }}>{a.storage_path.split("/").slice(1).join("/")}</td>
                  <td>{a.type}</td>
                  <td>{prettySize(a.file_size)}</td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
