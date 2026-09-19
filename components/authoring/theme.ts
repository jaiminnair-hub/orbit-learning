/**
 * Shared, token-backed style constants for the authoring editor.
 *
 * Every value here reads from app/globals.css's real design tokens — the
 * same ones Shell.tsx's Card and the admin reports/content consoles already
 * use (`var(--color-border)`, `var(--color-card)`, `var(--font-display)`,
 * `var(--radius-md)`, ...) — rather than the hardcoded hex this editor used
 * before (confirmed absent anywhere in components/authoring/*.tsx). One
 * place to update if the app's palette ever changes, instead of the same
 * handful of hex values drifting separately across five files.
 */

export const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  fontSize: ".85rem",
  fontFamily: "var(--font-sans)",
  color: "var(--color-foreground)",
  background: "var(--color-card)",
  boxSizing: "border-box",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: ".75rem",
  fontWeight: 600,
  color: "var(--color-muted-foreground)",
  marginBottom: 4,
  marginTop: 12,
};

/** A workspace region — Scenes, Stage, Timeline, Inspector. */
export const panelStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  padding: 14,
  background: "var(--color-card)",
};

/** A small uppercase eyebrow heading, e.g. above a panel's content. */
export const eyebrowStyle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: ".7rem",
  fontWeight: 700,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "var(--color-muted-foreground)",
  fontFamily: "var(--font-sans)",
};

/** The larger scope heading naming what the Inspector is currently editing. */
export const scopeHeadingStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: "1rem",
  fontWeight: 700,
  fontFamily: "var(--font-display)",
  color: "var(--color-foreground)",
};

/** A nested group box — question items, marker rows, choice lists. */
export const boxStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  marginTop: 10,
  background: "var(--color-background)",
};

export const dangerColor = "var(--color-destructive)";

export const dangerButtonStyle: React.CSSProperties = {
  color: dangerColor,
  fontSize: ".75rem",
  marginTop: 10,
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
};

export const mutedTextStyle: React.CSSProperties = {
  fontSize: ".8rem",
  color: "var(--color-muted-foreground)",
};

/** The accent used for "currently selected" — a slide, a block, a tab. */
export const selectedBorder = "2px solid var(--accent-secondary)";
export const selectedBackground = "color-mix(in oklch, var(--accent-secondary) 10%, var(--color-card))";

export const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "none",
  cursor: "pointer",
  fontSize: ".8rem",
  padding: "0 4px",
  color: "var(--color-muted-foreground)",
};

/** A small pill-shaped tab button, active/inactive. */
export function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    fontSize: ".72rem",
    fontWeight: 600,
    padding: "6px 4px",
    background: active ? "var(--accent-secondary)" : "transparent",
    color: active ? "var(--accent-secondary-foreground)" : "var(--color-muted-foreground)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  };
}
