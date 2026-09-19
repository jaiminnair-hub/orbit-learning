import { IconCheckSquare, IconSparkle, IconShieldCheck } from "./orbit-icons";

const ITEMS = [
  { icon: IconCheckSquare, label: "Verified certificates" },
  { icon: IconSparkle, label: "AI-powered" },
  { icon: IconShieldCheck, label: "Enterprise-grade" },
];

export function ProofStrip() {
  return (
    <ul className="proof-strip">
      {ITEMS.map(({ icon: Icon, label }) => (
        <li key={label} className="proof-strip__item">
          <Icon />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
