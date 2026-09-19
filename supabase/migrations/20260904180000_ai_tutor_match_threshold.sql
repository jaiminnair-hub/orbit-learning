-- Recalibrates match_ai_knowledge_chunks' default similarity threshold.
-- lib/ai/tutor.ts's caller always passes an explicit threshold, so this is
-- a consistency fix, not a behavior change for the real app path — see
-- that file's own comment for the real-score evidence (0.44-0.50 relevant,
-- ~0.08 unrelated, against real AICredits text-embedding-3-small output)
-- behind moving 0.50 -> 0.30. The original 0.50 default rejected almost
-- every genuinely relevant question.

create or replace function match_ai_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_org_id uuid,
  match_threshold double precision default 0.30,
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
