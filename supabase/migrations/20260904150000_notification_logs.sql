-- Transactional email delivery audit. Service role only: delivery evidence can contain personal email addresses.
create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  recipient_email text,
  recipient_user_id uuid references profiles(id) on delete set null,
  notification_type text not null check (notification_type in ('org_invitation', 'assessment_assignment', 'course_auto_enrollment', 'course_reenrollment_due')),
  provider text not null default 'resend', subject text not null,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text, error_message text, entity_type text, entity_id uuid,
  metadata jsonb not null default '{}'::jsonb, sent_at timestamptz, created_at timestamptz not null default now()
);
create index notification_logs_org_created_at_idx on notification_logs (org_id, created_at desc);
create index notification_logs_entity_idx on notification_logs (entity_type, entity_id);
alter table notification_logs enable row level security;
-- Deliberately no authenticated-user policies. A scoped admin audit view can be added later.
create or replace function reject_notification_log_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'notification_logs is append-only: DELETE is not permitted';
  end if;

  -- Preserve delivery evidence when a referenced organization or profile is
  -- deleted. PostgreSQL implements ON DELETE SET NULL as an UPDATE, so that
  -- narrow FK cleanup must remain possible while every other edit is blocked.
  if new.id is distinct from old.id
    or new.recipient_email is distinct from old.recipient_email
    or new.notification_type is distinct from old.notification_type
    or new.provider is distinct from old.provider
    or new.subject is distinct from old.subject
    or new.status is distinct from old.status
    or new.provider_message_id is distinct from old.provider_message_id
    or new.error_message is distinct from old.error_message
    or new.entity_type is distinct from old.entity_type
    or new.entity_id is distinct from old.entity_id
    or new.metadata is distinct from old.metadata
    or new.sent_at is distinct from old.sent_at
    or new.created_at is distinct from old.created_at
    or (new.org_id is not null and new.org_id is distinct from old.org_id)
    or (new.recipient_user_id is not null and new.recipient_user_id is distinct from old.recipient_user_id)
  then
    raise exception 'notification_logs is append-only: UPDATE is not permitted (only FK-cascade nullification is allowed)';
  end if;

  return new;
end;
$$;
create trigger notification_logs_reject_update before update on notification_logs for each row execute function reject_notification_log_mutation();
create trigger notification_logs_reject_delete before delete on notification_logs for each row execute function reject_notification_log_mutation();
