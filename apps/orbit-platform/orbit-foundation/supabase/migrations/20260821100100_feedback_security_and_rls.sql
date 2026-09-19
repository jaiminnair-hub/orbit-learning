-- Orbit 360 Feedback: privacy helpers, integrity checks, and RLS.
-- This migration deliberately hides assignment identities and raw responses
-- from feedback subjects. Reports are released only through explicit controls.

create or replace function public.is_feedback_admin(
  target_organization_id uuid default public.current_organization_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_product_role('feedback', 'feedback_admin', target_organization_id);
$$;

create or replace function public.is_feedback_cycle_reviewer(target_cycle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_product('feedback')
    and exists (
    select 1
    from public.feedback_review_assignments assignment
    where assignment.cycle_id = target_cycle_id
      and assignment.reviewer_user_id = auth.uid()
      and assignment.status not in ('withdrawn', 'expired')
  );
$$;

create or replace function public.is_feedback_assignment_reviewer(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_product('feedback')
    and exists (
      select 1
      from public.feedback_review_assignments assignment
      where assignment.id = target_assignment_id
        and assignment.organization_id = public.current_organization_id()
        and assignment.reviewer_user_id = auth.uid()
        and assignment.status not in ('withdrawn', 'expired')
    );
$$;

create or replace function public.can_edit_feedback_assignment(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_feedback_assignment_reviewer(target_assignment_id)
    and exists (
      select 1
      from public.feedback_review_assignments assignment
      join public.feedback_cycles cycle on cycle.id = assignment.cycle_id
      where assignment.id = target_assignment_id
        and cycle.status = 'live'
        and assignment.status in ('not_started', 'in_progress')
    );
$$;

create or replace function public.is_feedback_subject_for_participant(target_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.feedback_cycle_participants participant
    where participant.id = target_participant_id
      and participant.organization_id = public.current_organization_id()
      and participant.subject_user_id = auth.uid()
  );
$$;

create or replace function public.can_view_feedback_report(target_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_feedback_admin()
    or (
      public.can_access_product('feedback')
      and exists (
      select 1
      from public.feedback_report_releases release
      where release.participant_id = target_participant_id
        and release.organization_id = public.current_organization_id()
        and release.status = 'released'
        and release.release_to_subject
        and release.subject_user_id = auth.uid()
      )
    );
$$;

create or replace function public.can_manage_feedback_action_plan(target_action_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_feedback_admin()
    or (
      public.can_access_product('feedback')
      and exists (
      select 1
      from public.feedback_action_plans action_plan
      where action_plan.id = target_action_plan_id
        and action_plan.organization_id = public.current_organization_id()
        and action_plan.subject_user_id = auth.uid()
      )
    );
$$;

-- A temporary, explicit onboarding path for the first Feedback product build.
-- It grants a 14-day Feedback trial only to the current organization owner.
-- Billing will replace this workflow; it must not reactivate a cancelled or
-- suspended subscription.
create or replace function public.start_feedback_trial_for_current_org()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_organization_id();
  existing_status text;
begin
  if target_organization_id is null
     or not public.has_organization_role('org_owner', target_organization_id) then
    raise exception 'Only an organization owner can start a Feedback trial.';
  end if;

  select status into existing_status
  from public.organization_product_entitlements
  where organization_id = target_organization_id
    and product_key = 'feedback'
  for update;

  if found and existing_status in ('active', 'trial') then
    null;
  elsif found then
    raise exception 'Feedback access is not available for this organization. Contact Orbit support.';
  else
    insert into public.organization_product_entitlements (
      organization_id, product_key, status, plan_tier, starts_at, ends_at, seat_limit
    ) values (
      target_organization_id, 'feedback', 'trial', 'foundation', now(), now() + interval '14 days', 25
    );
  end if;

  insert into public.product_role_assignments (
    organization_id, user_id, product_key, role_key, granted_by
  ) values (
    target_organization_id, auth.uid(), 'feedback', 'feedback_admin', auth.uid()
  ) on conflict (organization_id, user_id, product_key, role_key) do nothing;

  insert into public.audit_events (organization_id, actor_id, event_type, entity_type, entity_id)
  values (target_organization_id, auth.uid(), 'feedback.trial_started', 'product_entitlement', 'feedback');
end;
$$;

-- The only approval path that turns a nomination into a reviewer task. It
-- grants the reviewer the minimum Feedback product role and records the audit
-- trail; administrators never need browser-level write access to role grants.
create or replace function public.approve_feedback_rater_nomination(target_nomination_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nomination public.feedback_rater_nominations%rowtype;
  participant_id uuid;
  assignment_id uuid;
begin
  select * into nomination
  from public.feedback_rater_nominations
  where id = target_nomination_id
    and organization_id = public.current_organization_id()
    and status = 'pending'
  for update;

  if not found or not public.is_feedback_admin(nomination.organization_id) then
    raise exception 'This nomination cannot be approved.';
  end if;

  select id into participant_id
  from public.feedback_cycle_participants
  where cycle_id = nomination.cycle_id
    and organization_id = nomination.organization_id
    and subject_user_id = nomination.subject_user_id;

  if participant_id is null then
    raise exception 'The feedback subject is not a participant in this cycle.';
  end if;

  insert into public.product_role_assignments (
    organization_id, user_id, product_key, role_key, granted_by
  ) values (
    nomination.organization_id, nomination.reviewer_user_id, 'feedback',
    case when nomination.rater_group = 'self' then 'subject' else 'reviewer' end,
    auth.uid()
  ) on conflict (organization_id, user_id, product_key, role_key) do nothing;

  insert into public.feedback_review_assignments (
    organization_id, cycle_id, participant_id, subject_user_id, reviewer_user_id,
    rater_group, due_at
  )
  select nomination.organization_id, nomination.cycle_id, participant_id,
    nomination.subject_user_id, nomination.reviewer_user_id, nomination.rater_group,
    cycle.feedback_closes_at
  from public.feedback_cycles cycle
  where cycle.id = nomination.cycle_id
  returning id into assignment_id;

  update public.feedback_rater_nominations
  set status = 'approved', reviewed_by = auth.uid()
  where id = nomination.id;

  insert into public.audit_events (organization_id, actor_id, event_type, entity_type, entity_id)
  values (nomination.organization_id, auth.uid(), 'feedback.rater_approved', 'feedback_rater_nomination', nomination.id::text);

  return assignment_id;
end;
$$;

-- Prevent mismatched rows such as a response for one cycle being attached to a
-- question from another. This is important because raw responses are the most
-- sensitive data in a 360 program.
create or replace function public.validate_feedback_response_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.feedback_review_assignments assignment
    join public.feedback_cycle_questions question
      on question.id = new.cycle_question_id
     and question.organization_id = new.organization_id
     and question.cycle_id = assignment.cycle_id
    where assignment.id = new.assignment_id
      and assignment.organization_id = new.organization_id
  ) then
    raise exception 'Response assignment and question must belong to the same feedback cycle.';
  end if;
  return new;
end;
$$;

create trigger feedback_responses_validate_scope
  before insert or update on public.feedback_responses
  for each row execute function public.validate_feedback_response_scope();

create or replace function public.validate_feedback_assignment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_subject_id uuid;
  expected_cycle_id uuid;
begin
  select participant.subject_user_id, participant.cycle_id
    into expected_subject_id, expected_cycle_id
  from public.feedback_cycle_participants participant
  where participant.id = new.participant_id
    and participant.organization_id = new.organization_id;

  if expected_subject_id is null
     or expected_subject_id <> new.subject_user_id
     or expected_cycle_id <> new.cycle_id then
    raise exception 'Feedback assignment must match its participant and cycle.';
  end if;

  return new;
end;
$$;

create trigger feedback_assignments_validate_scope
  before insert or update on public.feedback_review_assignments
  for each row execute function public.validate_feedback_assignment_scope();

create or replace function public.validate_feedback_cycle_launch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'live' and old.status <> 'live' then
    if new.feedback_opens_at is null or new.feedback_closes_at is null then
      raise exception 'A live cycle requires opening and closing dates.';
    end if;

    if not exists (
      select 1 from public.feedback_cycle_questions question where question.cycle_id = new.id
    ) then
      raise exception 'A live cycle requires at least one question.';
    end if;

    if not exists (
      select 1 from public.feedback_cycle_participants participant where participant.cycle_id = new.id
    ) then
      raise exception 'A live cycle requires at least one participant.';
    end if;

    if exists (
      select 1
      from public.feedback_review_assignments assignment
      where assignment.cycle_id = new.id
        and assignment.rater_group in ('peer', 'direct_report', 'external')
      group by assignment.subject_user_id, assignment.rater_group
      having count(*) < new.anonymous_group_threshold
    ) then
      raise exception 'Anonymous rater groups must meet the configured minimum threshold before launch.';
    end if;

    new.launched_at = coalesce(new.launched_at, now());
  end if;

  if new.status = 'closed' and old.status = 'live' then
    new.closed_at = coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

create trigger feedback_cycles_validate_launch
  before update on public.feedback_cycles
  for each row execute function public.validate_feedback_cycle_launch();

create trigger feedback_competencies_set_updated_at before update on public.feedback_competencies
  for each row execute function public.set_updated_at();
create trigger feedback_question_templates_set_updated_at before update on public.feedback_question_templates
  for each row execute function public.set_updated_at();
create trigger feedback_template_questions_set_updated_at before update on public.feedback_template_questions
  for each row execute function public.set_updated_at();
create trigger feedback_cycles_set_updated_at before update on public.feedback_cycles
  for each row execute function public.set_updated_at();
create trigger feedback_cycle_questions_set_updated_at before update on public.feedback_cycle_questions
  for each row execute function public.set_updated_at();
create trigger feedback_cycle_participants_set_updated_at before update on public.feedback_cycle_participants
  for each row execute function public.set_updated_at();
create trigger feedback_rater_nominations_set_updated_at before update on public.feedback_rater_nominations
  for each row execute function public.set_updated_at();
create trigger feedback_review_assignments_set_updated_at before update on public.feedback_review_assignments
  for each row execute function public.set_updated_at();
create trigger feedback_responses_set_updated_at before update on public.feedback_responses
  for each row execute function public.set_updated_at();
create trigger feedback_report_releases_set_updated_at before update on public.feedback_report_releases
  for each row execute function public.set_updated_at();
create trigger feedback_action_plans_set_updated_at before update on public.feedback_action_plans
  for each row execute function public.set_updated_at();
create trigger feedback_action_goals_set_updated_at before update on public.feedback_action_goals
  for each row execute function public.set_updated_at();

alter table public.feedback_competencies enable row level security;
alter table public.feedback_question_templates enable row level security;
alter table public.feedback_template_questions enable row level security;
alter table public.feedback_cycles enable row level security;
alter table public.feedback_cycle_questions enable row level security;
alter table public.feedback_cycle_participants enable row level security;
alter table public.feedback_rater_nominations enable row level security;
alter table public.feedback_review_assignments enable row level security;
alter table public.feedback_responses enable row level security;
alter table public.feedback_report_releases enable row level security;
alter table public.feedback_action_plans enable row level security;
alter table public.feedback_action_goals enable row level security;

create policy feedback_competencies_select on public.feedback_competencies
  for select to authenticated
  using (public.can_access_product('feedback', null, organization_id));
create policy feedback_competencies_admin_write on public.feedback_competencies
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_question_templates_admin_only on public.feedback_question_templates
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));
create policy feedback_template_questions_admin_only on public.feedback_template_questions
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_cycles_select_member on public.feedback_cycles
  for select to authenticated
  using (
    public.is_feedback_admin(organization_id)
    or public.is_feedback_cycle_reviewer(id)
  );
create policy feedback_cycles_admin_write on public.feedback_cycles
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_cycle_questions_select_authorized on public.feedback_cycle_questions
  for select to authenticated
  using (
    public.is_feedback_admin(organization_id)
    or public.is_feedback_cycle_reviewer(cycle_id)
  );
create policy feedback_cycle_questions_admin_write on public.feedback_cycle_questions
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_participants_select_authorized on public.feedback_cycle_participants
  for select to authenticated
  using (
    public.is_feedback_admin(organization_id)
    or (
      subject_user_id = auth.uid()
      and public.can_access_product('feedback', 'subject', organization_id)
    )
  );
create policy feedback_participants_admin_write on public.feedback_cycle_participants
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_nominations_select_subject_or_admin on public.feedback_rater_nominations
  for select to authenticated
  using (
    public.is_feedback_admin(organization_id)
    or (
      subject_user_id = auth.uid()
      and public.can_access_product('feedback', 'subject', organization_id)
    )
  );
create policy feedback_nominations_subject_create on public.feedback_rater_nominations
  for insert to authenticated
  with check (
    subject_user_id = auth.uid()
    and nominated_by = auth.uid()
    and status = 'pending'
    and public.can_access_product('feedback', 'subject', organization_id)
    and exists (
      select 1
      from public.feedback_cycles cycle
      join public.feedback_cycle_participants participant
        on participant.cycle_id = cycle.id
       and participant.organization_id = cycle.organization_id
      where cycle.id = feedback_rater_nominations.cycle_id
        and cycle.organization_id = feedback_rater_nominations.organization_id
        and participant.subject_user_id = auth.uid()
        and cycle.allow_subject_rater_nominations
        and cycle.status in ('draft', 'review', 'scheduled')
    )
  );
create policy feedback_nominations_admin_manage on public.feedback_rater_nominations
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_assignments_select_reviewer_or_admin on public.feedback_review_assignments
  for select to authenticated
  using (
    public.is_feedback_admin(organization_id)
    or public.is_feedback_assignment_reviewer(id)
  );
create policy feedback_assignments_admin_write on public.feedback_review_assignments
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));
create policy feedback_assignments_reviewer_progress on public.feedback_review_assignments
  for update to authenticated
  using (public.can_edit_feedback_assignment(id))
  with check (public.is_feedback_assignment_reviewer(id));

create policy feedback_responses_select_reviewer_only on public.feedback_responses
  for select to authenticated
  using (public.is_feedback_assignment_reviewer(assignment_id));
create policy feedback_responses_reviewer_insert on public.feedback_responses
  for insert to authenticated
  with check (public.can_edit_feedback_assignment(assignment_id));
create policy feedback_responses_reviewer_update on public.feedback_responses
  for update to authenticated
  using (public.can_edit_feedback_assignment(assignment_id))
  with check (public.can_edit_feedback_assignment(assignment_id));

create policy feedback_report_releases_select_subject_or_admin on public.feedback_report_releases
  for select to authenticated
  using (public.can_view_feedback_report(participant_id));
create policy feedback_report_releases_admin_write on public.feedback_report_releases
  for all to authenticated
  using (public.is_feedback_admin(organization_id))
  with check (public.is_feedback_admin(organization_id));

create policy feedback_action_plans_select_subject_or_admin on public.feedback_action_plans
  for select to authenticated
  using (public.can_manage_feedback_action_plan(id));
create policy feedback_action_plans_subject_or_admin_write on public.feedback_action_plans
  for all to authenticated
  using (public.can_manage_feedback_action_plan(id))
  with check (
    public.is_feedback_admin(organization_id)
    or subject_user_id = auth.uid()
  );
create policy feedback_action_plans_admin_insert on public.feedback_action_plans
  for insert to authenticated
  with check (public.is_feedback_admin(organization_id));
create policy feedback_action_plans_subject_insert on public.feedback_action_plans
  for insert to authenticated
  with check (
    subject_user_id = auth.uid()
    and public.can_access_product('feedback', 'subject', organization_id)
  );

create policy feedback_action_goals_select_subject_or_admin on public.feedback_action_goals
  for select to authenticated
  using (public.can_manage_feedback_action_plan(action_plan_id));
create policy feedback_action_goals_subject_or_admin_write on public.feedback_action_goals
  for all to authenticated
  using (public.can_manage_feedback_action_plan(action_plan_id))
  with check (public.can_manage_feedback_action_plan(action_plan_id));

revoke all on function public.is_feedback_admin(uuid) from public;
revoke all on function public.is_feedback_cycle_reviewer(uuid) from public;
revoke all on function public.is_feedback_assignment_reviewer(uuid) from public;
revoke all on function public.can_edit_feedback_assignment(uuid) from public;
revoke all on function public.is_feedback_subject_for_participant(uuid) from public;
revoke all on function public.can_view_feedback_report(uuid) from public;
revoke all on function public.can_manage_feedback_action_plan(uuid) from public;
revoke all on function public.start_feedback_trial_for_current_org() from public;
revoke all on function public.approve_feedback_rater_nomination(uuid) from public;

grant execute on function public.is_feedback_admin(uuid) to authenticated;
grant execute on function public.is_feedback_cycle_reviewer(uuid) to authenticated;
grant execute on function public.is_feedback_assignment_reviewer(uuid) to authenticated;
grant execute on function public.can_edit_feedback_assignment(uuid) to authenticated;
grant execute on function public.is_feedback_subject_for_participant(uuid) to authenticated;
grant execute on function public.can_view_feedback_report(uuid) to authenticated;
grant execute on function public.can_manage_feedback_action_plan(uuid) to authenticated;
grant execute on function public.start_feedback_trial_for_current_org() to authenticated;
grant execute on function public.approve_feedback_rater_nomination(uuid) to authenticated;
