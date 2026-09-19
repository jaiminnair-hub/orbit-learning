import { CoursesConsole } from "./courses-console";

export default function CoursesAdminPage() {
  return (
    <div className="studio-page">
      <header className="studio-page__heading"><p>Orbit Studio · Courses</p><h1>Turn learning material into a deliberate journey.</h1><span>A course sequences reusable learning objects into modules and lessons. Only a published course becomes visible to learners.</span></header>
      <CoursesConsole />
    </div>
  );
}
