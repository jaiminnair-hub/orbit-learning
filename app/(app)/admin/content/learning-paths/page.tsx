import { LearningPathsConsole } from "./learning-paths-console";

export default function LearningPathsAdminPage() {
  return (
    <div className="studio-page">
      <header className="studio-page__heading"><p>Orbit Studio · Learning paths</p><h1>Sequence courses into one journey.</h1><span>A learning path is an ordered set of published courses a learner is assigned as a single unit — a next course only makes sense once the one before it is done.</span></header>
      <LearningPathsConsole />
    </div>
  );
}
