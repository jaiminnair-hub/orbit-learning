/**
 * The orbit's centre — "Capability" stays fixed at the middle of the six
 * stages. Two animations run independently on separate elements so they
 * never fight over the same CSS property: a continuous slow breathing pulse
 * on the core disc itself, and a brief brighten-flash on a ring behind it
 * timed to each stage's arrival (see the `--i` stagger in globals.css).
 */
export function CapabilityCore() {
  return (
    <div className="capability-core" aria-hidden="true">
      <span className="capability-core__flare" />
      <span className="capability-core__ring capability-core__ring--1" />
      <span className="capability-core__ring capability-core__ring--2" />
      <span className="capability-core__disc">
        <span className="capability-core__label">Capability</span>
      </span>
    </div>
  );
}
