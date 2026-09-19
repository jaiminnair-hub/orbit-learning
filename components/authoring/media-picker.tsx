"use client";

import { useEffect, useState } from "react";
import { ASSET_BACKED_TYPES } from "@/lib/authoring/block-factory";
import { fieldStyle } from "./fields";
import { mutedTextStyle } from "./theme";

/**
 * Picks a content-library asset for the block types that cannot exist without
 * one.
 *
 * The block is created only once an asset is chosen — inserting an
 * image block with an empty assetId would fail the schema on the spot, which
 * is the rule the whole factory is built around.
 */

interface Asset {
  id: string;
  type: string;
  storage_path: string;
}

/** Which library asset types can back which block type. */
const COMPATIBLE: Record<(typeof ASSET_BACKED_TYPES)[number], string[]> = {
  image: ["image"],
  imageGallery: ["image"],
  video: ["video"],
  audio: ["audio"],
  labeledGraphic: ["image"],
  hotspot: ["image"],
};

const BLOCK_LABEL: Record<(typeof ASSET_BACKED_TYPES)[number], string> = {
  image: "Image",
  imageGallery: "Image gallery",
  video: "Video",
  audio: "Audio",
  labeledGraphic: "Labelled graphic",
  hotspot: "Hotspots",
};

export function MediaPicker({
  onPick,
  onCancel,
}: {
  onPick: (type: (typeof ASSET_BACKED_TYPES)[number], assetId: string) => void;
  onCancel: () => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [blockType, setBlockType] = useState<(typeof ASSET_BACKED_TYPES)[number]>("image");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/content/assets");
      if (!res.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const json = await res.json();
      if (cancelled) return;
      setAssets(json.data.assets ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const usable = assets.filter((a) => COMPATIBLE[blockType].includes(a.type));

  return (
    <div style={overlay}>
      <div style={dialog}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Insert media</h3>

        <label style={{ display: "block", fontSize: ".8rem", fontWeight: 600, marginBottom: 4 }}>
          Block type
          <select
            value={blockType}
            onChange={(e) => setBlockType(e.target.value as (typeof ASSET_BACKED_TYPES)[number])}
            style={{ ...fieldStyle, marginTop: 4 }}
          >
            {ASSET_BACKED_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        {loading ? (
          <p style={{ fontSize: ".85rem" }}>Loading library…</p>
        ) : usable.length === 0 ? (
          <p style={{ ...mutedTextStyle, fontSize: ".85rem" }}>
            No {COMPATIBLE[blockType].join(" or ")} assets in the library yet. Upload one in the content library first.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0", maxHeight: 260, overflowY: "auto" }}>
            {usable.map((asset) => (
              <li key={asset.id}>
                <button
                  onClick={() => onPick(blockType, asset.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: 8,
                    border: "1px solid var(--color-border)",
                    borderRadius: 4,
                    marginBottom: 6,
                    cursor: "pointer",
                    background: "var(--color-card)",
                    fontSize: ".8rem",
                  }}
                >
                  {asset.storage_path.split("/").pop()}
                  <span style={{ color: "var(--color-muted-foreground)" }}> · {asset.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={onCancel} style={{ marginTop: 8 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Picks a saved block from the component library to reference. */
export function ComponentPicker({
  onPick,
  onCancel,
}: {
  onPick: (componentDefinitionId: string) => void;
  onCancel: () => void;
}) {
  const [components, setComponents] = useState<{ id: string; name: string; category: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/authoring/components");
      if (!res.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const json = await res.json();
      if (cancelled) return;
      setComponents(json.data.components ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={overlay}>
      <div style={dialog}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Insert a saved block</h3>
        <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>
          Saved blocks are referenced, not copied — editing one updates every course that uses it.
        </p>

        {loading ? (
          <p style={{ fontSize: ".85rem" }}>Loading…</p>
        ) : components.length === 0 ? (
          <p style={{ ...mutedTextStyle, fontSize: ".85rem" }}>No saved blocks yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0", maxHeight: 260, overflowY: "auto" }}>
            {components.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onPick(c.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: 8,
                    border: "1px solid var(--color-border)",
                    borderRadius: 4,
                    marginBottom: 6,
                    cursor: "pointer",
                    background: "var(--color-card)",
                    fontSize: ".8rem",
                  }}
                >
                  {c.name}
                  {c.category && <span style={{ color: "var(--color-muted-foreground)" }}> · {c.category}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={onCancel} style={{ marginTop: 8 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
};

const dialog: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  width: "min(460px, 92vw)",
  maxHeight: "80vh",
  overflowY: "auto",
};
