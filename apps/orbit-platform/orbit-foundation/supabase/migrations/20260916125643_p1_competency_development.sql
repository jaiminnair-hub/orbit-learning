-- Foundation owns competency versions. Learning receives only consented,
-- released, anonymity-gated development signals through the caller's JWT.
begin;
create schema if not exists competency_private;
revoke all on schema competency_private from public, anon;
grant usage on schema competency_private to authenticated;

create table public.competency_framework_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  library_key text not null check (library_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  version integer not null check (version > 0),
  name text not null check (length(name) between 2 and 160),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  definitions jsonb not null check (jsonb_typeof(definitions) = 'array'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id, library_key, version),
  unique (organization_id, id)
);
create table public.competency_learning_links (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  framework_id uuid not null, competency_code text not null,
  content_kind text not null check (content_kind in ('course','learning_path','assessment')),
  content_id uuid not null, target_level integer not null check (target_level between 1 and 5),
  source text not null check (source in ('manual','import','ai')),
  rationale text not null check (length(rationale) between 1 and 2000),
  status text not null default 'draft' check (status in ('draft','approved','rejected','archived')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), approved_at timestamptz,
  foreign key (organization_id, framework_id) references public.competency_framework_versions(organization_id,id),
  unique (organization_id,id)
);
create table public.competency_question_maps (
  organization_id uuid not null, question_id uuid primary key,
  framework_id uuid not null, competency_code text not null,
  target_level integer not null check (target_level between 1 and 5),
  -- Explicit ordered rating cut-offs. Frequency is never silently labelled proficiency.
  level_thresholds numeric[] not null,
  approved_by uuid not null references auth.users(id),
  foreign key (question_id, organization_id) references public.feedback_cycle_questions(id,organization_id) on delete cascade,
  foreign key (organization_id, framework_id) references public.competency_framework_versions(organization_id,id)
);
create table public.competency_privacy_preferences (
  organization_id uuid not null, user_id uuid not null,
  consented boolean not null default false, notice_version text not null default 'development-v1',
  retained_from timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (organization_id,user_id),
  foreign key (organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
create table public.competency_recommendation_choices (
  organization_id uuid not null, user_id uuid not null, link_id uuid not null,
  decision text not null check (decision in ('accepted','dismissed')),
  updated_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '365 days',
  primary key (organization_id,user_id,link_id),
  foreign key (organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade,
  foreign key (organization_id,link_id) references public.competency_learning_links(organization_id,id) on delete cascade
);
create table public.competency_rights_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, user_id uuid not null,
  kind text not null check (kind in ('correction','deletion')),
  detail text not null check (length(detail) between 1 and 2000),
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text, created_at timestamptz not null default now(), resolved_at timestamptz,
  foreign key (organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete cascade
);
do $$ declare t text; begin
  foreach t in array array['competency_framework_versions','competency_learning_links','competency_question_maps','competency_privacy_preferences','competency_recommendation_choices','competency_rights_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Single transaction boundary: no browser CRUD grants, no arbitrary subject ID.
create function competency_private.workspace(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  org uuid := public.current_organization_id(); actor uuid := auth.uid();
  is_admin boolean; f public.competency_framework_versions; d jsonb; l jsonb;
  result jsonb := '{}'::jsonb; fid uuid; rid uuid; code text; target integer;
  consent boolean; cutoff timestamptz; thresholds numeric[]; q public.feedback_cycle_questions;
begin
  if actor is null or org is null or not public.can_access_product('competencies',null,org) then
    raise exception using errcode='42501', message='Competencies membership, entitlement and product role are required.';
  end if;
  is_admin := public.can_access_product('competencies','competency_admin',org);
  if action not in ('read','consent','choose','rights','export') and not is_admin then
    raise exception using errcode='42501', message='Competency administrator access required.';
  end if;
  -- Serialise per-organisation writes, including version creation/approval and consent.
  perform pg_advisory_xact_lock(hashtextextended(org::text, 731));
  delete from public.competency_recommendation_choices where organization_id=org and expires_at <= now();
  delete from public.competency_rights_requests where organization_id=org and status='resolved' and resolved_at < now()-interval '365 days';

  if action='save_framework' then
    if jsonb_typeof(payload->'definitions') is distinct from 'array' or jsonb_array_length(payload->'definitions') not between 1 and 100 then
      raise exception 'Provide 1 to 100 competency definitions.';
    end if;
    for d in select value from jsonb_array_elements(payload->'definitions') loop
      if coalesce(d->>'code','') !~ '^[a-z][a-z0-9_-]{1,79}$' or length(coalesce(d->>'name','')) not between 2 and 120
        or length(coalesce(d->>'definition','')) not between 10 and 2000
        or coalesce(d->>'category','') not in ('core','functional','leadership')
        or jsonb_typeof(d->'levels') is distinct from 'array' then raise exception 'Invalid competency definition.'; end if;
      if jsonb_array_length(d->'levels') not between 3 and 5 then raise exception 'Define 3 to 5 behavioural proficiency levels.'; end if;
      for l in select value from jsonb_array_elements(d->'levels') loop
        if jsonb_typeof(l) <> 'string' or length(l#>>'{}') not between 5 and 500 then raise exception 'Each level needs a behavioural description.'; end if;
      end loop;
    end loop;
    if (select count(*) <> count(distinct value->>'code') from jsonb_array_elements(payload->'definitions')) then raise exception 'Competency codes must be unique.'; end if;
    fid := nullif(payload->>'id','')::uuid;
    if fid is not null then
      select * into f from public.competency_framework_versions where id=fid and organization_id=org and status='draft' for update;
      if not found then raise exception 'Only a draft in your organisation can be edited.'; end if;
      update public.competency_framework_versions set name=payload->>'name', definitions=payload->'definitions' where id=fid;
    else
      insert into public.competency_framework_versions(organization_id,library_key,version,name,definitions,created_by)
      values(org,payload->>'libraryKey',coalesce((select max(version)+1 from public.competency_framework_versions where organization_id=org and library_key=payload->>'libraryKey'),1),payload->>'name',payload->'definitions',actor)
      returning id into fid;
    end if;
    result := jsonb_build_object('id',fid);
  elsif action in ('publish_framework','archive_framework') then
    update public.competency_framework_versions set status=case when action='publish_framework' then 'published' else 'archived' end,
      published_at=case when action='publish_framework' then now() else published_at end
      where id=(payload->>'id')::uuid and organization_id=org and status=case when action='publish_framework' then 'draft' else 'published' end
      returning id into fid;
    if fid is null then raise exception 'Framework state changed; refresh and retry.'; end if;
  elsif action in ('save_link','map_question') then
    fid := (payload->>'frameworkId')::uuid; code := payload->>'competencyCode'; target := (payload->>'targetLevel')::integer;
    select * into f from public.competency_framework_versions where id=fid and organization_id=org and status='published';
    select value into d from jsonb_array_elements(coalesce(f.definitions,'[]')) where value->>'code'=code;
    if d is null or target is null or target not between 1 and jsonb_array_length(d->'levels') then raise exception 'Choose a published competency and a valid target level.'; end if;
    if action='save_link' then
      insert into public.competency_learning_links(organization_id,framework_id,competency_code,content_kind,content_id,target_level,source,rationale,created_by)
      values(org,fid,code,payload->>'contentKind',(payload->>'contentId')::uuid,target,coalesce(payload->>'source','manual'),payload->>'rationale',actor) returning id into rid;
      result := jsonb_build_object('id',rid);
    else
      if not public.is_feedback_admin(org) then raise exception using errcode='42501',message='Feedback administrator access is also required.'; end if;
      select question.* into q from public.feedback_cycle_questions question join public.feedback_cycles c on c.id=question.cycle_id
        where question.id=(payload->>'questionId')::uuid and question.organization_id=org and c.organization_id=org and c.status='draft' and question.question_type='rating';
      if not found then raise exception 'Map only rating questions in draft cycles.'; end if;
      select array_agg(value::numeric order by ordinality) into thresholds from jsonb_array_elements_text(payload->'thresholds') with ordinality;
      if array_length(thresholds,1) is distinct from jsonb_array_length(d->'levels') or thresholds[1] <> (q.scale_definition->>'min')::numeric
        or thresholds[array_length(thresholds,1)] > (q.scale_definition->>'max')::numeric
        or exists(select 1 from generate_subscripts(thresholds,1) i where i>1 and thresholds[i]<=thresholds[i-1]) then raise exception 'Use one increasing rating threshold per level, starting at the question scale minimum.'; end if;
      insert into public.competency_question_maps values(org,q.id,fid,code,target,thresholds,actor)
      on conflict(question_id) do update set framework_id=excluded.framework_id,competency_code=excluded.competency_code,target_level=excluded.target_level,level_thresholds=excluded.level_thresholds,approved_by=actor;
    end if;
  elsif action in ('approve_link','reject_link','archive_link') then
    update public.competency_learning_links set status=case action when 'approve_link' then 'approved' when 'reject_link' then 'rejected' else 'archived' end,
      approved_by=actor,approved_at=now() where id=(payload->>'id')::uuid and organization_id=org
      and status=case when action='archive_link' then 'approved' else 'draft' end returning id into rid;
    if rid is null then raise exception 'Mapping state changed; refresh and retry.'; end if;
  elsif action='consent' then
    if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose whether to enable development recommendations.'; end if;
    insert into public.competency_privacy_preferences(organization_id,user_id,consented) values(org,actor,(payload->>'enabled')::boolean)
      on conflict(organization_id,user_id) do update set consented=excluded.consented,updated_at=now();
    if not (payload->>'enabled')::boolean then delete from public.competency_recommendation_choices where organization_id=org and user_id=actor; end if;
  elsif action='choose' then
    if not exists(select 1 from public.competency_privacy_preferences where organization_id=org and user_id=actor and consented) then raise exception 'Enable recommendations first.'; end if;
    if not exists(select 1 from public.competency_learning_links where id=(payload->>'id')::uuid and organization_id=org and status='approved') then raise exception 'Approved mapping not found.'; end if;
    insert into public.competency_recommendation_choices(organization_id,user_id,link_id,decision) values(org,actor,(payload->>'id')::uuid,payload->>'decision')
      on conflict(organization_id,user_id,link_id) do update set decision=excluded.decision,updated_at=now(),expires_at=now()+interval '365 days';
  elsif action='rights' then
    insert into public.competency_rights_requests(organization_id,user_id,kind,detail) values(org,actor,payload->>'kind',payload->>'detail') returning id into rid;
    if payload->>'kind'='deletion' then
      delete from public.competency_recommendation_choices where organization_id=org and user_id=actor;
      insert into public.competency_privacy_preferences(organization_id,user_id,consented,retained_from) values(org,actor,false,now())
      on conflict(organization_id,user_id) do update set consented=false,retained_from=now(),updated_at=now();
      update public.competency_rights_requests set status='resolved',resolution='Development choices deleted; processing disabled. Historical reports are excluded from future regeneration. Source 360 retention is managed separately.',resolved_at=now() where id=rid;
    end if;
  elsif action='resolve_rights' then
    if length(coalesce(payload->>'resolution','')) not between 5 and 2000 then raise exception 'Explain the correction or resolution.'; end if;
    update public.competency_rights_requests set status='resolved',resolution=payload->>'resolution',resolved_at=now()
      where id=(payload->>'id')::uuid and organization_id=org and status='open';
  elsif action not in ('read','export') then raise exception 'Unsupported competency action.';
  end if;

  insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
    values(org,actor,'competencies.'||action,'competency_workspace',coalesce(fid,rid)::text,'{}');
  if action not in ('read','export') then return result; end if;
  select consented, greatest(retained_from,now()-interval '365 days') into consent,cutoff
    from public.competency_privacy_preferences where organization_id=org and user_id=actor;
  result := jsonb_build_object('organizationId',org,'isAdmin',is_admin,'consented',coalesce(consent,false),'noticeVersion','development-v1',
    'frameworks',coalesce((select jsonb_agg(to_jsonb(v) order by v.library_key,v.version desc) from public.competency_framework_versions v where v.organization_id=org and ((is_admin and action='read') or v.status='published')),'[]'),
    'links',coalesce((select jsonb_agg(to_jsonb(m)) from public.competency_learning_links m join public.competency_framework_versions v on v.id=m.framework_id where m.organization_id=org and ((is_admin and action='read') or (m.status='approved' and v.status='published'))),'[]'),
    'rights',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.competency_rights_requests r where r.organization_id=org and (r.user_id=actor or (is_admin and action='read'))),'[]'),
    'choices',coalesce((select jsonb_agg(to_jsonb(c)) from public.competency_recommendation_choices c where c.organization_id=org and c.user_id=actor),'[]'),
    'questionMaps',case when is_admin and action='read' then coalesce((select jsonb_agg(to_jsonb(m)) from public.competency_question_maps m where m.organization_id=org),'[]') else '[]' end,
    'questions',case when is_admin and action='read' and public.is_feedback_admin(org) then coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,'cycle',c.name,'scale',q.scale_definition)) from public.feedback_cycle_questions q join public.feedback_cycles c on c.id=q.cycle_id where q.organization_id=org and c.status='draft' and q.question_type='rating'),'[]') else '[]' end);

  -- Calculate only the signed-in subject's released data. No raw answers,
  -- comments, reviewer identities, response counts, or hidden groups leave SQL.
  -- Gate per competency AND group, so partial answers cannot bypass anonymity.
  if coalesce(consent,false) and public.has_product_entitlement('feedback',org) then
    with groups as (
      select m.framework_id,m.competency_code,m.target_level,m.level_thresholds,
        s.id subject_id,c.id cycle_id,c.name cycle_name,release.released_at,r.rater_group,
        avg(a.rating) rating, count(distinct r.id) respondents,c.anonymous_group_threshold
      from public.feedback_cycle_roster_subjects s
      join public.organization_people p on p.id=s.subject_person_id and p.organization_id=org and p.linked_user_id=actor and p.employment_status='active'
      join public.feedback_cycles c on c.id=s.cycle_id and c.organization_id=org and c.status in ('closed','report_ready')
      join public.feedback_directory_report_releases release on release.roster_subject_id=s.id and release.organization_id=org and release.status='released' and release.released_at>=cutoff
      join public.feedback_cycle_roster_raters r on r.subject_roster_id=s.id and r.organization_id=org and r.status in ('approved','invited','submitted')
      join public.feedback_invitation_deliveries delivery on delivery.roster_rater_id=r.id and delivery.organization_id=org and delivery.status='completed'
      join public.feedback_invitation_responses a on a.delivery_id=delivery.id and a.organization_id=org and not a.is_skipped and a.rating is not null
      join public.competency_question_maps m on m.question_id=a.cycle_question_id and m.organization_id=org
      join public.competency_framework_versions v on v.id=m.framework_id and v.organization_id=org and v.status='published'
      where s.organization_id=org and s.status<>'withdrawn'
      group by m.framework_id,m.competency_code,m.target_level,m.level_thresholds,s.id,c.id,c.name,release.released_at,r.rater_group,c.anonymous_group_threshold
    ), visible as (
      select *, (select count(*)::integer from unnest(level_thresholds) t where t<=rating) observed_level
      from groups where rater_group in ('self','manager','skip_manager') or respondents>=anonymous_group_threshold
    )
    select result || jsonb_build_object('signals',coalesce(jsonb_agg(jsonb_build_object(
      'frameworkId',framework_id,'competencyCode',competency_code,'targetLevel',target_level,'observedLevel',observed_level,
      'gap',greatest(0,target_level-observed_level),'sourceGroup',rater_group,'cycleId',cycle_id,'cycleName',cycle_name,'releasedAt',released_at,
      'basis','Released feedback, interpreted using administrator-approved rating thresholds. This is a development signal, not certified proficiency.'
    ) order by released_at desc),'[]')) into result from visible;
  else result := result || '{"signals":[]}'::jsonb; end if;
  return result;
end $$;
revoke all on function competency_private.workspace(text,jsonb) from public,anon;
grant execute on function competency_private.workspace(text,jsonb) to authenticated;
create function public.competency_workspace(action text, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = public, pg_temp as $$
  select competency_private.workspace(action,payload);
$$;
revoke all on function public.competency_workspace(text,jsonb) from public,anon;
grant execute on function public.competency_workspace(text,jsonb) to authenticated;
commit;
