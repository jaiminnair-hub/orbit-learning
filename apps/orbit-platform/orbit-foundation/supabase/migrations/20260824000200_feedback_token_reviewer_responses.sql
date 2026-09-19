-- Orbit 360: token-bound reviewer answers. Invitation recipients never receive
-- browser access to this table; service endpoints validate the hashed token.
create table if not exists public.feedback_invitation_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  delivery_id uuid not null references public.feedback_invitation_deliveries(id) on delete cascade,
  cycle_question_id uuid not null references public.feedback_cycle_questions(id) on delete cascade,
  rating numeric(4,2) check (rating is null or (rating >= 0 and rating <= 10)),
  comment text check (comment is null or char_length(comment) <= 8000),
  is_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, cycle_question_id),
  check (rating is not null or comment is not null or is_skipped)
);

create index if not exists feedback_invitation_responses_delivery_idx on public.feedback_invitation_responses (organization_id, delivery_id, updated_at desc);
create index if not exists feedback_invitation_responses_cycle_idx on public.feedback_invitation_responses (organization_id, cycle_id, cycle_question_id);

create or replace function public.validate_feedback_invitation_response_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.feedback_invitation_deliveries delivery
    join public.feedback_cycle_questions question on question.id = new.cycle_question_id and question.organization_id = new.organization_id and question.cycle_id = delivery.cycle_id
    where delivery.id = new.delivery_id and delivery.organization_id = new.organization_id and delivery.cycle_id = new.cycle_id
  ) then raise exception 'Invitation response must belong to the same organization and feedback cycle.'; end if;
  return new;
end;
$$;

drop trigger if exists feedback_invitation_responses_validate_scope on public.feedback_invitation_responses;
create trigger feedback_invitation_responses_validate_scope before insert or update on public.feedback_invitation_responses for each row execute function public.validate_feedback_invitation_response_scope();
drop trigger if exists feedback_invitation_responses_set_updated_at on public.feedback_invitation_responses;
create trigger feedback_invitation_responses_set_updated_at before update on public.feedback_invitation_responses for each row execute function public.set_updated_at();
alter table public.feedback_invitation_responses enable row level security;
-- No browser policies: only the server-side token endpoint may access answers.
revoke all on function public.validate_feedback_invitation_response_scope() from public;
