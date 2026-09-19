/**
 * Minimal line icons for the orbit hero — one per stage node, plus three for
 * the proof strip. Deliberately simpler than `stage-pictorial.tsx`'s
 * illustrations (those live in the larger expand panels below the hero);
 * these need to read clearly at ~40px inside a node circle. All draw with
 * `currentColor` so they inherit the node's navy ink.
 */
const common = { fill: "none", "aria-hidden": true } as const;

export function IconBook() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M16 8.5c-2.4-1.6-5.4-2-8.5-1.5v15c3.1-.5 6.1-.1 8.5 1.5 2.4-1.6 5.4-2 8.5-1.5v-15c-3.1-.5-6.1-.1-8.5 1.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 8.5v15" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconPencil() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M8 24l1-5.2L20.3 7.5a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L13.2 23 8 24Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M18.5 9.5l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheckSquare() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <rect x="7" y="7" width="18" height="18" rx="3.5" stroke="currentColor" strokeWidth="2" />
      <path d="M11.5 16.3l3 3 6-6.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPresenter() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <rect x="14" y="7" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 15v2M22.5 15v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="16" r="2.4" stroke="currentColor" strokeWidth="2" />
      <path d="M5 25c0-3 2-5.3 4-5.3s4 2.3 4 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconBarChart() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M6 25V25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="7" y="17" width="4.4" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="13.8" y="12" width="4.4" height="13" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="20.6" y="7.5" width="4.4" height="17.5" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconSprout() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M16 25V15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 16c0-4.5-3.5-7-8-7 0 4.5 3.5 7 8 7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 12.5c0-3.6 2.8-5.6 6.4-5.6 0 3.6-2.8 5.6-6.4 5.6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLayers() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M16 6.5 27 12 16 17.5 5 12 16 6.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M5 17l11 5.5L27 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 22l11 5.5L27 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSparkle() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M16 6l2.1 6.9L25 15l-6.9 2.1L16 24l-2.1-6.9L7 15l6.9-2.1L16 6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShieldCheck() {
  return (
    <svg viewBox="0 0 32 32" {...common}>
      <path d="M16 6l9 3.3v6.4c0 5.7-3.8 9.9-9 11.3-5.2-1.4-9-5.6-9-11.3V9.3L16 6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 16.3l2.8 2.8L20.3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const STAGE_ICONS: Record<string, () => React.ReactElement> = {
  learn: IconBook,
  practice: IconPencil,
  assess: IconCheckSquare,
  demonstrate: IconPresenter,
  measure: IconBarChart,
  grow: IconSprout,
};
