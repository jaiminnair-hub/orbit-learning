import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";

export default async function AuthoringHome() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const orgId = session?.orgId ?? "";

  const [courses, objects, assets] = await Promise.all([
    supabase.from("courses").select("status").eq("org_id", orgId).is("deleted_at", null),
    supabase.from("learning_objects").select("status").eq("org_id", orgId).is("deleted_at", null),
    supabase.from("content_assets").select("id").eq("org_id", orgId).is("deleted_at", null),
  ]);

  const published = (courses.data ?? []).filter((c) => c.status === "published").length;
  const drafts = (courses.data ?? []).length - published;

  return (
    <div className="authoring-home">
      <section className="authoring-home__hero">
        <div>
          <p className="authoring-home__eyebrow">Orbit Studio · Content workspace</p>
          <h1>Build learning people want to return to.</h1>
          <p>Shape a course once, reuse the right learning objects, and publish only when every piece is ready.</p>
          <div className="authoring-home__actions">
            <Link href="/admin/content/courses">Open courses <span>→</span></Link>
            <Link href="/admin/content/assets">Add to library</Link>
          </div>
        </div>
        <div className="authoring-home__hero-orbit" aria-label={`${published} published courses and ${drafts} courses in progress`}>
          <div><strong>{published}</strong><span>published<br />course{published === 1 ? "" : "s"}</span></div>
          <div><strong>{drafts}</strong><span>course{drafts === 1 ? "" : "s"}<br />in progress</span></div>
        </div>
      </section>

      <section className="authoring-home__workspaces" aria-label="Authoring workspaces">
        <Link className="studio-workspace studio-workspace--courses" href="/admin/content/courses">
          <span className="studio-workspace__number">01</span><span className="studio-workspace__icon" aria-hidden="true">◫</span>
          <h2>Courses</h2><p>Bring modules and learning objects into one intentional learning journey.</p>
          <strong>{published} published · {drafts} in progress <i>→</i></strong>
        </Link>
        <Link className="studio-workspace studio-workspace--objects" href="/admin/content/learning-objects">
          <span className="studio-workspace__number">02</span><span className="studio-workspace__icon" aria-hidden="true">◌</span>
          <h2>Learning objects</h2><p>Create once, update once, and reuse the building blocks that make a course work.</p>
          <strong>{(objects.data ?? []).length} reusable object{(objects.data ?? []).length === 1 ? "" : "s"} <i>→</i></strong>
        </Link>
        <Link className="studio-workspace studio-workspace--library" href="/admin/content/assets">
          <span className="studio-workspace__number">03</span><span className="studio-workspace__icon" aria-hidden="true">↗</span>
          <h2>Content library</h2><p>Keep source material, media, documents and SCORM packages in one controlled place.</p>
          <strong>{(assets.data ?? []).length} uploaded file{(assets.data ?? []).length === 1 ? "" : "s"} <i>→</i></strong>
        </Link>
      </section>

      <section className="authoring-flow">
        <div><p className="authoring-home__eyebrow">The content system</p><h2>One source. Many learning moments.</h2></div>
        <ol>
          <li><span>01</span><strong>Store</strong><p>Upload and organize source material.</p></li>
          <li><span>02</span><strong>Shape</strong><p>Turn material into a reusable learning object.</p></li>
          <li><span>03</span><strong>Compose</strong><p>Place objects in lessons and modules.</p></li>
          <li><span>04</span><strong>Publish</strong><p>Release a reviewed course to learners.</p></li>
        </ol>
      </section>
    </div>
  );
}
