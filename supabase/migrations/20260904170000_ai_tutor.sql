-- AI Tutor Lite: org-scoped vector knowledge over published course content.
--
-- The application owns extraction and chunking because authored course text
-- lives in a validated nested JSON specification. This table stores only the
-- rendered learner-visible passages and their AICredits embeddings. No draft
-- course, learning object, or specification is eligible for indexing.

create extension if not exists vector with schema extensions;

create table ai_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  learning_object_id uuid references learning_objects(id) on delete cascade,
  source_key text not null,
  content_hash text not null check (length(content_hash) = 64),
  course_title text not null,
  module_title text,
  lesson_title text,
  page_title text,
  content text not null check (length(btrim(content)) > 0),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, source_key)
);

create trigger ai_knowledge_chunks_set_updated_at
  before update on ai_knowledge_chunks
  for each row execute function set_updated_at();

create index ai_knowledge_chunks_org_course_idx
  on ai_knowledge_chunks (org_id, course_id);

create index ai_knowledge_chunks_embedding_idx
  on ai_knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table ai_knowledge_chunks enable row level security;

-- There are intentionally no authenticated policies. Knowledge passages are
-- a server-side retrieval index, not a client-readable content API. The
-- authenticated Tutor route derives org_id from the session and calls this
-- function through the service role.

create or replace function ai_tutor_published_sources(match_org_id uuid)
returns table (
  course_id uuid,
  course_title text,
  course_description text,
  module_id uuid,
  module_title text,
  lesson_id uuid,
  lesson_title text,
  learning_object_id uuid,
  learning_object_title text,
  learning_object_description text,
  source text,
  course_specification_id uuid,
  specification jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    course.id,
    course.title,
    course.description,
    module.id,
    module.title,
    lesson.id,
    lesson.title,
    learning_object.id,
    learning_object.title,
    learning_object.description,
    learning_object.source,
    specification.id,
    specification.spec
  from courses as course
  join modules as module on module.course_id = course.id
  join lessons as lesson on lesson.module_id = module.id
  join lesson_learning_objects as link on link.lesson_id = lesson.id
  join learning_objects as learning_object on learning_object.id = link.learning_object_id
  left join course_specifications as specification
    on specification.id = learning_object.course_specification_id
    and specification.org_id = match_org_id
    and specification.status = 'published'
    and specification.deleted_at is null
  where course.org_id = match_org_id
    and course.status = 'published'
    and course.deleted_at is null
    and learning_object.org_id = match_org_id
    and learning_object.status = 'published'
    and learning_object.deleted_at is null
    and (
      learning_object.source <> 'authored'
      or specification.id is not null
    )
  order by course.title, module.sequence, lesson.sequence, link.sequence;
$$;

revoke all on function ai_tutor_published_sources(uuid) from public;
revoke all on function ai_tutor_published_sources(uuid) from anon;
revoke all on function ai_tutor_published_sources(uuid) from authenticated;
grant execute on function ai_tutor_published_sources(uuid) to service_role;

create or replace function match_ai_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_org_id uuid,
  match_threshold double precision default 0.50,
  match_count integer default 6
)
returns table (
  id uuid,
  course_id uuid,
  learning_object_id uuid,
  course_title text,
  module_title text,
  lesson_title text,
  page_title text,
  content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    chunk.id,
    chunk.course_id,
    chunk.learning_object_id,
    chunk.course_title,
    chunk.module_title,
    chunk.lesson_title,
    chunk.page_title,
    chunk.content,
    1 - (chunk.embedding <=> query_embedding) as similarity
  from ai_knowledge_chunks as chunk
  join courses as course on course.id = chunk.course_id
  where chunk.org_id = match_org_id
    and course.org_id = match_org_id
    and course.status = 'published'
    and course.deleted_at is null
    and 1 - (chunk.embedding <=> query_embedding) >= match_threshold
  order by chunk.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 12);
$$;

revoke all on function match_ai_knowledge_chunks(extensions.vector, uuid, double precision, integer) from public;
revoke all on function match_ai_knowledge_chunks(extensions.vector, uuid, double precision, integer) from anon;
revoke all on function match_ai_knowledge_chunks(extensions.vector, uuid, double precision, integer) from authenticated;
grant execute on function match_ai_knowledge_chunks(extensions.vector, uuid, double precision, integer) to service_role;
