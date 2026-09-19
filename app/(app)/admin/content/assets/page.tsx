import { AssetsConsole } from "./assets-console";

export default function AssetsPage() {
  return (
    <div className="studio-page">
      <header className="studio-page__heading"><p>Orbit Studio · Library</p><h1>Bring your learning materials into one place.</h1><span>Files and SCORM packages stay private to your organisation until you deliberately shape them into learning.</span></header>
      <AssetsConsole />
    </div>
  );
}
