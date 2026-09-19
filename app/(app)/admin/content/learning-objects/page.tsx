import { ObjectsConsole } from "./objects-console";

export default function LearningObjectsPage() {
  return (
    <div className="studio-page">
      <header className="studio-page__heading"><p>Orbit Studio · Learning objects</p><h1>Create once. Reuse with confidence.</h1><span>A learning object is a reusable building block. Improve it once and each course can use the newer version when it is next published.</span></header>
      <ObjectsConsole />
    </div>
  );
}
