-- Orbit 360: allow the directory-native roster to launch a cycle without
-- forcing reviewers to first become authenticated Orbit users.

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
      select 1 from public.feedback_cycle_questions question
      where question.cycle_id = new.id and question.organization_id = new.organization_id
    ) then
      raise exception 'A live cycle requires at least one question.';
    end if;

    -- Either the legacy account-based participant model or the newer private
    -- directory roster is valid. A cycle never needs both.
    if not exists (
      select 1 from public.feedback_cycle_participants participant
      where participant.cycle_id = new.id and participant.organization_id = new.organization_id
    ) and not exists (
      select 1 from public.feedback_cycle_roster_subjects subject
      where subject.cycle_id = new.id
        and subject.organization_id = new.organization_id
        and subject.status <> 'withdrawn'
    ) then
      raise exception 'A live cycle requires at least one feedback subject.';
    end if;

    if exists (
      select 1 from public.feedback_cycle_participants participant
      where participant.cycle_id = new.id and participant.organization_id = new.organization_id
    ) then
      if exists (
        select 1 from public.feedback_review_assignments assignment
        where assignment.cycle_id = new.id
          and assignment.rater_group in ('peer', 'direct_report', 'external')
        group by assignment.subject_user_id, assignment.rater_group
        having count(*) < new.anonymous_group_threshold
      ) then
        raise exception 'Anonymous rater groups must meet the configured minimum threshold before launch.';
      end if;
    else
      if not exists (
        select 1 from public.feedback_cycle_roster_raters rater
        where rater.cycle_id = new.id
          and rater.organization_id = new.organization_id
          and rater.status = 'approved'
      ) then
        raise exception 'A live directory-based cycle requires at least one approved reviewer.';
      end if;
      if exists (
        select 1 from public.feedback_cycle_roster_raters rater
        where rater.cycle_id = new.id
          and rater.organization_id = new.organization_id
          and rater.status = 'approved'
          and rater.rater_group in ('peer', 'same_team', 'cross_functional', 'direct_report', 'external')
        group by rater.subject_roster_id, rater.rater_group
        having count(*) < new.anonymous_group_threshold
      ) then
        raise exception 'Anonymous rater groups must meet the configured minimum threshold before launch.';
      end if;
    end if;

    new.launched_at = coalesce(new.launched_at, now());
  end if;

  if new.status = 'closed' and old.status = 'live' then
    new.closed_at = coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;
