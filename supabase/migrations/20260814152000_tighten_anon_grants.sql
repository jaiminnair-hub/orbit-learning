-- The remote (hosted) project's "Automatically expose new tables" setting
-- granted `anon` full table privileges (SELECT/INSERT/UPDATE/DELETE) when
-- the core schema migration first created these tables — before the
-- explicit grants migration ran, which only intended SELECT for anon.
-- RLS already blocks anon from every row that matters (current_org_id()
-- is null for unauthenticated requests), so this was never an active
-- hole — but least-privilege hygiene, and keeping local/remote identical
-- rather than silently divergent, says this should be tightened
-- explicitly rather than left as an artifact of a dashboard default.

revoke all on all tables in schema public from anon;
grant select on all tables in schema public to anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select on tables to anon;
