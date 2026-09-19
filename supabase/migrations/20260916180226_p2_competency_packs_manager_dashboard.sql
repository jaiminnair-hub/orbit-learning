-- P2-A: attributable starter packs cloned into organisation-owned draft frameworks.
-- P2-B: aggregate-only manager view over explicitly assigned 360 subjects.
begin;

-- Personal recommendations and manager reporting are separate purposes.
alter table public.competency_privacy_preferences
  add column manager_consented boolean not null default false,
  add column manager_consented_at timestamptz;
create function competency_private.reset_manager_consent()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if not new.consented or (TG_OP='UPDATE' and new.retained_from is distinct from old.retained_from) then
    new.manager_consented:=false;
    new.manager_consented_at:=null;
  end if;
  return new;
end $$;
revoke all on function competency_private.reset_manager_consent() from public,anon,authenticated;
create trigger reset_manager_consent before insert or update on public.competency_privacy_preferences
for each row execute function competency_private.reset_manager_consent();

create table public.competency_library_packs (
  id uuid primary key default gen_random_uuid(),
  pack_key text not null,
  version integer not null check (version > 0),
  name text not null check (length(name) between 2 and 160),
  role_family text not null check (length(role_family) between 2 and 120),
  description text not null check (length(description) between 10 and 1000),
  definitions jsonb not null check (jsonb_typeof(definitions)='array' and jsonb_array_length(definitions) between 1 and 30),
  source_name text not null,
  source_url text not null check (source_url ~ '^https://'),
  license_name text not null,
  license_url text not null check (license_url ~ '^https://'),
  attribution text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(pack_key,version)
);
create table public.competency_pack_activations (
  organization_id uuid not null references public.foundation_organizations(id) on delete cascade,
  pack_id uuid not null references public.competency_library_packs(id),
  framework_id uuid not null,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  primary key(organization_id,pack_id),
  foreign key(organization_id,framework_id) references public.competency_framework_versions(organization_id,id) on delete cascade
);
alter table public.competency_library_packs enable row level security;
alter table public.competency_pack_activations enable row level security;
revoke all on public.competency_library_packs,public.competency_pack_activations from anon,authenticated;

insert into public.competency_library_packs(pack_key,version,name,role_family,description,definitions,source_name,source_url,license_name,license_url,attribution) values
('people_manager',1,'People Manager Essentials','People managers','Core behaviours for first-line managers who set direction, coach performance and build trust.',
'[{"code":"active_listening","name":"Active listening","definition":"Attends to what others say, checks understanding and responds to the meaning conveyed.","category":"leadership","levels":["Listens without interrupting when prompted.","Summarises what was heard and asks clarifying questions.","Surfaces unstated concerns and reconciles competing perspectives.","Builds team norms that improve listening and mutual understanding."]},{"code":"developing_others","name":"Developing others","definition":"Supports people to build capability through clear feedback, practice and appropriately challenging opportunities.","category":"leadership","levels":["Shares specific feedback when asked.","Agrees practical development actions and follows up.","Adapts coaching and assignments to individual needs.","Creates a sustained coaching culture and develops other managers."]},{"code":"planning_prioritisation","name":"Planning and prioritisation","definition":"Translates objectives into sequenced work, clear ownership and realistic delivery commitments.","category":"leadership","levels":["Organises own assigned work with guidance.","Sets clear team priorities and monitors commitments.","Balances dependencies, capacity and changing risks across the team.","Shapes operating priorities across teams and improves planning systems."]},{"code":"conflict_resolution","name":"Conflict resolution","definition":"Addresses disagreement constructively while protecting working relationships and accountable decisions.","category":"leadership","levels":["Raises disagreements respectfully with support.","Clarifies interests and agrees a workable next step.","Mediates difficult disputes and restores productive collaboration.","Builds organisational practices that prevent and resolve systemic conflict."]}]'::jsonb,
'O*NET 31.0 Database — USDOL/ETA','https://www.onetcenter.org/database.html','CC BY 4.0','https://creativecommons.org/licenses/by/4.0/','Informed by O*NET® 31.0 Database descriptors from the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), under CC BY 4.0. Orbit authored the role-family selection, wording and all behavioural levels. USDOL/ETA has not approved, endorsed or tested these adaptations. O*NET® is a trademark of USDOL/ETA. Organisation review is required.'),
('customer_service',1,'Customer Service Essentials','Customer service','Core behaviours for service teams handling customer needs, problems and commitments.',
'[{"code":"service_orientation","name":"Service orientation","definition":"Actively looks for ways to understand needs and provide useful, timely service.","category":"functional","levels":["Responds courteously to clearly stated requests.","Clarifies needs and takes ownership through resolution.","Anticipates recurring needs and improves the customer experience.","Shapes service standards and systems across channels."]},{"code":"active_listening","name":"Active listening","definition":"Attends to the customer, checks understanding and responds to the issue and emotion conveyed.","category":"core","levels":["Listens without interrupting when prompted.","Paraphrases the issue and confirms the desired outcome.","Identifies unstated needs and de-escalates complex conversations.","Coaches others and improves listening standards using service evidence."]},{"code":"problem_solving","name":"Problem solving","definition":"Uses available evidence to define a problem, evaluate options and implement an effective resolution.","category":"functional","levels":["Uses a known procedure for routine issues.","Investigates causes and selects an appropriate resolution.","Resolves ambiguous cross-team issues and prevents recurrence.","Designs systemic improvements for complex service problems."]},{"code":"reliability","name":"Reliability and follow-through","definition":"Keeps commitments, communicates changes early and closes the loop with customers and colleagues.","category":"core","levels":["Completes assigned follow-ups with reminders.","Tracks commitments and communicates status proactively.","Coordinates dependencies and recovers at-risk commitments.","Builds reliable service controls and accountability across teams."]}]'::jsonb,
'O*NET 31.0 Database — USDOL/ETA','https://www.onetcenter.org/database.html','CC BY 4.0','https://creativecommons.org/licenses/by/4.0/','Informed by O*NET® 31.0 Database descriptors from the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), under CC BY 4.0. Orbit authored the role-family selection, wording and all behavioural levels. USDOL/ETA has not approved, endorsed or tested these adaptations. O*NET® is a trademark of USDOL/ETA. Organisation review is required.'),
('consultative_sales',1,'Consultative Sales Essentials','Consultative sales','Core behaviours for understanding customer value, shaping solutions and maintaining trustworthy commercial relationships.',
'[{"code":"needs_discovery","name":"Needs discovery","definition":"Uses structured inquiry and evidence to understand customer goals, constraints and decision criteria.","category":"functional","levels":["Captures stated needs using a prepared question set.","Connects needs, stakeholders and success measures.","Surfaces hidden constraints and reframes complex business needs.","Establishes discovery standards for strategic opportunities."]},{"code":"persuasion","name":"Ethical persuasion","definition":"Presents relevant evidence and options to help stakeholders make an informed decision without misrepresentation.","category":"functional","levels":["Explains approved value points accurately.","Tailors evidence to stated priorities and handles routine concerns.","Builds alignment among stakeholders with competing interests.","Shapes organisation-wide standards for trustworthy influence."]},{"code":"negotiation","name":"Negotiation","definition":"Works toward agreements that clarify value, commitments, boundaries and sustainable next steps.","category":"functional","levels":["Uses approved terms and escalates exceptions.","Trades variables deliberately and records clear commitments.","Leads complex multi-party negotiations while protecting long-term value.","Designs negotiation strategy and coaches high-stakes commercial teams."]},{"code":"relationship_management","name":"Relationship management","definition":"Builds credible working relationships through relevance, consistency and transparent follow-through.","category":"core","levels":["Maintains professional contact and completes promised actions.","Builds trust through useful insight and dependable follow-through.","Coordinates executive and operational relationships across accounts.","Creates strategic partnerships and relationship standards across portfolios."]}]'::jsonb,
'O*NET 31.0 Database — USDOL/ETA','https://www.onetcenter.org/database.html','CC BY 4.0','https://creativecommons.org/licenses/by/4.0/','Informed by O*NET® 31.0 Database descriptors from the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), under CC BY 4.0. Orbit authored the role-family selection, wording and all behavioural levels. USDOL/ETA has not approved, endorsed or tested these adaptations. O*NET® is a trademark of USDOL/ETA. Organisation review is required.')
on conflict(pack_key,version) do nothing;

create function competency_private.p2_workspace(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare
  org uuid:=public.current_organization_id(); actor uuid:=auth.uid();
  is_admin boolean; selected_pack public.competency_library_packs; framework_id uuid; result jsonb;
  report_count integer:=0; manager_id uuid;
  period_days integer:=coalesce((payload->>'days')::integer,365);
  selected_cycle uuid:=nullif(payload->>'cycleId','')::uuid;
begin
  if actor is null or org is null or not public.can_access_product('competencies',null,org) then
    raise exception using errcode='42501',message='Competencies membership, entitlement and product role are required.';
  end if;
  if period_days not in (90,180,365) then raise exception 'Reporting period must be 90, 180 or 365 days.'; end if;
  is_admin:=public.can_access_product('competencies','competency_admin',org);
  if action='activate_pack' then
    if not is_admin then raise exception using errcode='42501',message='Competency administrator access required.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(org::text,731));
    select * into selected_pack from public.competency_library_packs where id=(payload->>'id')::uuid and is_active;
    if not found then raise exception 'Active competency pack not found.'; end if;
    if exists(select 1 from public.competency_pack_activations where organization_id=org and pack_id=selected_pack.id) then
      raise exception 'This pack version is already activated.';
    end if;
    insert into public.competency_framework_versions(organization_id,library_key,version,name,definitions,created_by)
    values(org,selected_pack.pack_key,coalesce((select max(version)+1 from public.competency_framework_versions where organization_id=org and library_key=selected_pack.pack_key),1),selected_pack.name,selected_pack.definitions,actor)
    returning id into framework_id;
    insert into public.competency_pack_activations values(org,selected_pack.id,framework_id,actor,now());
    insert into public.audit_events(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
    values(org,actor,'competencies.activate_pack','competency_library_pack',selected_pack.id::text,jsonb_build_object('frameworkId',framework_id));
    return jsonb_build_object('frameworkId',framework_id);
  elsif action='manager_consent' then
    if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose whether to share team aggregates.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(org::text,731));
    update public.competency_privacy_preferences
      set manager_consented=(payload->>'enabled')::boolean,
          manager_consented_at=case when (payload->>'enabled')::boolean then coalesce(manager_consented_at,now()) else null end,
          updated_at=now()
      where organization_id=org and user_id=actor and consented;
    if not found then raise exception 'Enable personal development recommendations first.'; end if;
    insert into public.audit_events(organization_id,actor_id,event_type,entity_type,metadata)
      values(org,actor,'competencies.manager_consent','competency_workspace',jsonb_build_object('enabled',payload->'enabled','noticeVersion','team-development-v1'));
    return jsonb_build_object('saved',true);
  elsif action='privacy' then
    return jsonb_build_object('managerConsented',coalesce((select manager_consented from public.competency_privacy_preferences where organization_id=org and user_id=actor),false),'teamNoticeVersion','team-development-v1');
  elsif action<>'read' then raise exception 'Unsupported P2 competency action.';
  end if;

  select p.id into manager_id from public.organization_people p
    where p.organization_id=org and p.linked_user_id=actor and p.employment_status='active' limit 1;
  if manager_id is not null then
    select count(distinct subject.linked_user_id) into report_count
    from public.feedback_cycle_roster_subjects s
    join public.organization_people subject on subject.id=s.subject_person_id and subject.organization_id=org and subject.employment_status='active' and subject.linked_user_id is not null
    where s.organization_id=org and s.manager_person_id=manager_id and s.status<>'withdrawn';
  end if;
  if selected_cycle is not null and not exists(select 1 from public.feedback_cycle_roster_subjects s
    where s.organization_id=org and s.manager_person_id=manager_id and s.cycle_id=selected_cycle and s.status<>'withdrawn') then
    raise exception using errcode='42501',message='This team is not assigned to you.';
  end if;

  result:=jsonb_build_object(
    'packs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'packKey',p.pack_key,'version',p.version,'name',p.name,'roleFamily',p.role_family,'description',p.description,'competencyCount',jsonb_array_length(p.definitions),'definitions',p.definitions,'sourceName',p.source_name,'sourceUrl',p.source_url,'licenseName',p.license_name,'licenseUrl',p.license_url,'attribution',p.attribution,'activated',a.pack_id is not null,'frameworkId',a.framework_id) order by p.role_family,p.name) from public.competency_library_packs p left join public.competency_pack_activations a on a.pack_id=p.id and a.organization_id=org where p.is_active),'[]'),
    'isAdmin',is_admin,'managerAccess',coalesce(report_count,0)>0,'directReportCount',coalesce(report_count,0),'periodDays',period_days,
    'managerConsented',coalesce((select manager_consented from public.competency_privacy_preferences where organization_id=org and user_id=actor),false),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.feedback_cycles c
      where c.organization_id=org and exists(select 1 from public.feedback_cycle_roster_subjects s where s.organization_id=org and s.cycle_id=c.id and s.manager_person_id=manager_id and s.status<>'withdrawn')),'[]'));

  if manager_id is null or not public.has_product_entitlement('feedback',org) then return result||'{"teamSignals":[]}'::jsonb; end if;
  with raw_groups as (
    select subject.linked_user_id subject_user_id,m.framework_id,m.competency_code,m.target_level,m.level_thresholds,
      s.id subject_roster_id,c.id cycle_id,a.cycle_question_id,r.rater_group,release.released_at,avg(a.rating) rating,count(distinct r.id) respondents,c.anonymous_group_threshold
    from public.feedback_cycle_roster_subjects s
    join public.organization_people subject on subject.id=s.subject_person_id and subject.organization_id=org and subject.employment_status='active' and subject.linked_user_id is not null
    join public.organization_memberships member on member.organization_id=org and member.user_id=subject.linked_user_id and member.status='active'
    join public.competency_privacy_preferences pref on pref.organization_id=org and pref.user_id=subject.linked_user_id and pref.consented and pref.manager_consented and pref.manager_consented_at is not null
    join public.feedback_cycles c on c.id=s.cycle_id and c.organization_id=org and c.status in ('closed','report_ready')
    join public.feedback_directory_report_releases release on release.roster_subject_id=s.id and release.organization_id=org and release.status='released' and release.released_at>=greatest(pref.retained_from,pref.manager_consented_at,now()-make_interval(days=>period_days))
    join public.feedback_cycle_roster_raters r on r.subject_roster_id=s.id and r.organization_id=org and r.status in ('approved','invited','submitted')
    join public.feedback_invitation_deliveries delivery on delivery.roster_rater_id=r.id and delivery.organization_id=org and delivery.status='completed'
    join public.feedback_invitation_responses a on a.delivery_id=delivery.id and a.organization_id=org and not a.is_skipped and a.rating is not null
    join public.competency_question_maps m on m.question_id=a.cycle_question_id and m.organization_id=org
    join public.competency_framework_versions f on f.id=m.framework_id and f.organization_id=org and f.status='published'
    where s.organization_id=org and s.manager_person_id=manager_id and s.status<>'withdrawn' and (selected_cycle is null or s.cycle_id=selected_cycle)
    group by subject.linked_user_id,m.framework_id,m.competency_code,m.target_level,m.level_thresholds,s.id,c.id,a.cycle_question_id,r.rater_group,release.released_at,c.anonymous_group_threshold
  ), visible_groups as (
    select *, (select count(*)::numeric from unnest(level_thresholds) threshold where threshold<=rating) observed_level
    from raw_groups where rater_group<>'self' and (rater_group in ('manager','skip_manager') or respondents>=greatest(3,anonymous_group_threshold))
  ), cycle_groups as (
    select subject_user_id,framework_id,competency_code,cycle_id,rater_group,released_at,
      max(target_level) target_level,avg(observed_level) observed_level
    from visible_groups group by subject_user_id,framework_id,competency_code,cycle_id,rater_group,released_at
  ), latest_groups as (
    select distinct on(subject_user_id,framework_id,competency_code,rater_group) * from cycle_groups
    order by subject_user_id,framework_id,competency_code,rater_group,released_at desc,cycle_id
  ), per_person as (
    select subject_user_id,framework_id,competency_code,max(target_level)::numeric target_level,avg(observed_level) observed_level
    from latest_groups group by subject_user_id,framework_id,competency_code
  ), team as (
    select framework_id,competency_code,count(*) member_count,round(avg(target_level),2) target_level,round(avg(observed_level),2) observed_level
    from per_person group by framework_id,competency_code having count(*)>=3
  )
  select result||jsonb_build_object('teamSignals',coalesce(jsonb_agg(jsonb_build_object(
    'frameworkId',framework_id,'competencyCode',competency_code,'memberCount',member_count,
    'targetLevel',target_level,'observedLevel',observed_level,'gap',greatest(0,target_level-observed_level),
    'basis',format('Aggregate of at least three people assigned to this manager in 360 cycles, with separate team-sharing consent and released feedback within %s days. Original reviewer thresholds still apply; this is a development signal.',period_days)
  ) order by greatest(0,target_level-observed_level) desc),'[]')) into result from team;
  return result;
end $$;
revoke all on function competency_private.p2_workspace(text,jsonb) from public,anon;
grant execute on function competency_private.p2_workspace(text,jsonb) to authenticated;
create function public.competency_p2_workspace(action text,payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$ select competency_private.p2_workspace(action,payload); $$;
revoke all on function public.competency_p2_workspace(text,jsonb) from public,anon;
grant execute on function public.competency_p2_workspace(text,jsonb) to authenticated;
commit;
