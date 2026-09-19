import { GuideClient } from "./guide-client";

export default function OrbitGuidePage() {
  return (
    <main className="tutor-page">
      <section className="tutor-hero">
        <div>
          <p>Orbit Guide · AI Tutor Lite</p>
          <h1>Ask your learning. Get a sourced answer.</h1>
          <span>
            Every answer is limited to your organisation&apos;s published courses. If the material does not contain the answer, Guide says so.
          </span>
        </div>
        <div className="tutor-hero__orbit" aria-hidden="true"><span>O</span></div>
      </section>
      <GuideClient />
    </main>
  );
}
