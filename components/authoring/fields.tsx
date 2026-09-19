"use client";

import { useEffect, useState } from "react";
import type { RichText } from "@/lib/spec";
import { dangerColor, fieldStyle, labelStyle, mutedTextStyle } from "./theme";

/**
 * Shared field primitives for the block inspector.
 *
 * The rich-text editor is deliberately a plain textarea over the structured
 * RichText model rather than a contenteditable WYSIWYG: RichText is spans and
 * marks, never an HTML string (lib/spec/primitives.ts), and a contenteditable
 * surface would spend its life converting between the two and losing
 * information in both directions. One blank-line-separated paragraph per
 * block is a faithful, lossless projection of what Phase 3 authoring
 * actually needs; inline marks are Phase 3B's editor surface.
 */

export { fieldStyle, labelStyle };

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input style={fieldStyle} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        style={fieldStyle}
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <select style={fieldStyle} value={value ?? ""} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: ".8rem" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** RichText -> plain text, one blank line between paragraphs. */
export function richTextToPlain(rt: RichText | undefined): string {
  if (!rt) return "";
  return rt.blocks.map((b) => b.spans.map((s) => s.text).join("")).join("\n\n");
}

/** Plain text -> RichText. Lines starting with "- " become bullet items. */
export function plainToRichText(text: string): RichText {
  const paragraphs = text.split(/\n{2,}/);
  const blocks: RichText["blocks"] = [];
  for (const para of paragraphs) {
    for (const line of para.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("- ")) {
        blocks.push({ kind: "bulletItem", spans: [{ text: trimmed.slice(2) }] });
      } else {
        blocks.push({ kind: "paragraph", spans: [{ text: trimmed }] });
      }
    }
  }
  // RichText allows an empty blocks array, but an empty *paragraph* keeps the
  // editor from collapsing a field the author has merely cleared.
  return { blocks: blocks.length ? blocks : [{ kind: "paragraph", spans: [{ text: "" }] }] };
}

export function RichTextField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: RichText | undefined;
  onChange: (v: RichText) => void;
  rows?: number;
}) {
  return (
    <Field label={label}>
      <textarea
        style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
        rows={rows}
        value={richTextToPlain(value)}
        onChange={(e) => onChange(plainToRichText(e.target.value))}
      />
      <span style={{ ...mutedTextStyle, fontSize: ".7rem" }}>
        Blank line between paragraphs. Start a line with &ldquo;- &rdquo; for a bullet.
      </span>
    </Field>
  );
}

/**
 * Picks a content-library asset by id.
 *
 * Exists because the accessibility gate can require a caption or transcript
 * file, and a gate an author cannot satisfy from the editor is worse than no
 * gate at all. The list is unfiltered by type: captions are WebVTT and
 * transcripts are usually text or a document, and `content_assets` has no
 * caption type to filter on — offering everything and trusting the author is
 * more honest than guessing at a filter that would hide the right file.
 */
export function AssetSelectField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (assetId: string | undefined) => void;
  hint?: string;
}) {
  const [assets, setAssets] = useState<Array<{ id: string; type: string; storage_path: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/content/assets").catch(() => null);
      if (!res?.ok) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const json = await res.json();
      if (cancelled) return;
      setAssets(json.data.assets ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Field label={label}>
      <select style={fieldStyle} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{loaded && assets.length === 0 ? "(no files in the library yet)" : "(none)"}</option>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.storage_path.split("/").pop()} · {a.type}
          </option>
        ))}
      </select>
      {hint && <span style={{ ...mutedTextStyle, fontSize: ".7rem" }}>{hint}</span>}
    </Field>
  );
}

export function ItemListControls({
  onAdd,
  onRemove,
  canRemove,
  addLabel,
}: {
  onAdd: () => void;
  onRemove: () => void;
  canRemove: boolean;
  addLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <button type="button" onClick={onAdd} style={{ fontSize: ".75rem" }}>
        + {addLabel}
      </button>
      {canRemove && (
        <button type="button" onClick={onRemove} style={{ fontSize: ".75rem", color: dangerColor }}>
          Remove
        </button>
      )}
    </div>
  );
}
