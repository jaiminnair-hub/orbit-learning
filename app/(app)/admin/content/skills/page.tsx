import { SkillsConsole } from "./skills-console";

export default function SkillsAdminPage() {
  return <div className="studio-page">
    <header className="studio-page__heading"><p>Orbit Studio · Skills</p><h1>Use one clear skills vocabulary.</h1><span>These tags connect authored courses and assessment questions to the learner Skills view. They record learning coverage—not inferred proficiency.</span></header>
    <SkillsConsole />
  </div>;
}
