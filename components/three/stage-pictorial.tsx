/**
 * One line-art pictorial per capability stage, drawn with `currentColor` so
 * the expand panel can recolor it per stage purely via CSS (`color` on the
 * wrapper), including a smooth transition when switching stages.
 */
export function StagePictorial({ stageKey }: { stageKey: string }) {
  switch (stageKey) {
    case "learn":
      return (
        <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
          <circle cx="80" cy="50" r="24" stroke="currentColor" strokeWidth="4" />
          <path d="M70 74 L70 84 M90 74 L90 84 M70 92 L90 92" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M80 20 L80 8" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M50 50 L38 50" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M110 50 L122 50" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M58 28 L49 19" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M102 28 L111 19" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="38" cy="50" r="3" fill="currentColor" />
          <circle cx="122" cy="50" r="3" fill="currentColor" />
          <circle cx="49" cy="19" r="3" fill="currentColor" />
          <circle cx="111" cy="19" r="3" fill="currentColor" />
        </svg>
      );
    case "practice":
      return (
        <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
          <circle cx="16" cy="60" r="6" fill="currentColor" />
          <path d="M22,60 L70,60" stroke="currentColor" strokeWidth="3" />
          <path d="M70,60 L120,30" stroke="currentColor" strokeWidth="3" />
          <path d="M70,60 L120,90" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 4" opacity=".45" />
          <circle cx="70" cy="60" r="5" stroke="currentColor" strokeWidth="3" />
          <circle cx="120" cy="30" r="6" fill="currentColor" />
          <circle cx="120" cy="90" r="5" stroke="currentColor" strokeWidth="2.5" opacity=".45" />
        </svg>
      );
    case "assess":
      return (
        <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
          <rect x="20" y="24" width="70" height="72" rx="8" stroke="currentColor" strokeWidth="3" />
          <path d="M34 44 L76 44 M34 58 L76 58 M34 72 L58 72" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" />
          <circle cx="120" cy="62" r="26" stroke="currentColor" strokeWidth="4" strokeDasharray="150" strokeDashoffset="30" transform="rotate(-90 120 62)" />
          <path d="M108 62 L117 71 L134 50" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "demonstrate":
      return (
        <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
          <circle cx="70" cy="46" r="30" stroke="currentColor" strokeWidth="4" />
          <path d="M58 46 L67 55 L84 36" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M56 72 L48 104 L70 92 L92 104 L84 72" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      );
    case "measure":
      return (
        <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
          <path d="M20 100 L140 100" stroke="currentColor" strokeWidth="2" opacity=".3" />
          <rect x="30" y="76" width="16" height="24" fill="currentColor" opacity=".5" />
          <rect x="60" y="58" width="16" height="42" fill="currentColor" opacity=".7" />
          <rect x="90" y="38" width="16" height="62" fill="currentColor" opacity=".85" />
          <rect x="120" y="20" width="16" height="80" fill="currentColor" />
          <path d="M30 70 L60 50 L90 32 L128 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="128" cy="16" r="4" fill="currentColor" />
        </svg>
      );
    case "grow":
      return (
        <svg viewBox="0 0 160 120" fill="none" aria-hidden="true">
          <path d="M40 108 L40 66" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".4" />
          <path d="M40 84 C28 78 24 68 31 60" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".4" />
          <path d="M40 72 C52 66 58 56 53 47" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".4" />
          <path d="M112 108 L112 40" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M112 70 C92 60 84 42 96 26" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M112 56 C132 48 140 30 128 16" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M112 86 C98 80 90 70 96 62" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
