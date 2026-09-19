-- Orbit 360: protect a reviewer from receiving more than one active private
-- link for the same feedback task. A replacement/resend must first revoke the
-- earlier delivery, preserving a clear auditable chain of custody.

with ranked_active_deliveries as (
  select id, row_number() over (partition by roster_rater_id order by created_at desc, id desc) as sequence
  from public.feedback_invitation_deliveries
  where status in ('queued', 'sent', 'opened', 'completed')
)
update public.feedback_invitation_deliveries delivery
set status = 'revoked'
from ranked_active_deliveries ranked
where delivery.id = ranked.id and ranked.sequence > 1;

create unique index if not exists feedback_invitation_one_active_link_per_rater_idx
  on public.feedback_invitation_deliveries (roster_rater_id)
  where status in ('queued', 'sent', 'opened', 'completed');

-- A confidential response may not be altered once the personal link is
-- completed, even by a service endpoint. Re-open must be an explicit,
-- auditable administrative workflow implemented in a later release.
create or replace function public.prevent_completed_feedback_response_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.feedback_invitation_deliveries
    where id = coalesce(new.delivery_id, old.delivery_id)
      and status = 'completed'
  ) then
    raise exception 'Completed confidential feedback cannot be changed.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists feedback_invitation_responses_prevent_completed_change on public.feedback_invitation_responses;
create trigger feedback_invitation_responses_prevent_completed_change
  before update or delete on public.feedback_invitation_responses
  for each row execute function public.prevent_completed_feedback_response_change();

revoke all on function public.prevent_completed_feedback_response_change() from public;

-- Browser administrators require delivery progress, not the recipient address
-- or a token hash. Remove direct browser table access and expose only the
-- minimum status projection. The view itself rechecks the organisation role.
revoke all on table public.feedback_invitation_deliveries from anon, authenticated;
drop policy if exists "feedback admins view invitation delivery" on public.feedback_invitation_deliveries;

create or replace view public.feedback_invitation_delivery_status
with (security_invoker = false) as
select
  delivery.organization_id,
  delivery.cycle_id,
  delivery.roster_rater_id,
  delivery.status,
  delivery.delivery_kind,
  delivery.sent_at,
  delivery.opened_at,
  delivery.completed_at,
  delivery.expires_at,
  delivery.created_at
from public.feedback_invitation_deliveries delivery
where public.is_feedback_admin(delivery.organization_id);

grant select on public.feedback_invitation_delivery_status to authenticated;
