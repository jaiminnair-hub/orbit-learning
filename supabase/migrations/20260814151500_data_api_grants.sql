-- RLS controls which *rows* a role can see; these grants control whether a
-- role can reach a table *at all* through the Data API — without them,
-- even service_role gets "permission denied," independent of RLS. A
-- dashboard-created hosted Supabase project sets this up implicitly
-- ("Automatically expose new tables"); a CLI-managed local project does
-- not, and relying on an unversioned dashboard toggle for something this
-- fundamental isn't acceptable — so it's explicit and migrated here for
-- both environments.
--
-- Safe to grant broadly at the table level because RLS (already enabled
-- on every table, previous migrations) is the actual row-level gate —
-- a table with RLS enabled and zero policies denies all rows by default
-- regardless of these grants (platform_admins, ai_usage_log).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

grant all on all sequences in schema public to service_role, authenticated;
grant usage on all sequences in schema public to anon;

grant execute on all functions in schema public to anon, authenticated, service_role;

-- So tables/functions added by future migrations inherit the same grants
-- automatically, without repeating this block every time.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role, authenticated;
alter default privileges in schema public grant usage on sequences to anon;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
