-- Orbit Platform Control: privacy-safe 360 health rollup.
-- Platform admins have zero read access to any feedback table today, and
-- that stays true here -- this function is never granted to `authenticated`.
-- It is reachable only from the `platform-feedback-health` Edge Function,
-- which authenticates the caller (the LMS server) with a shared bridge
-- secret, not a Foundation user session, then calls this function with the
-- service role. Nothing here is exposed via ordinary RLS/PostgREST access.
--
-- The contract is deliberately coarse: banded counts only, never an exact
-- small number that could re-identify a person, and never anything at the
-- rater-group or individual-response level -- that granularity is exactly
-- what the anonymous-group threshold already protects elsewhere.

-- count(*) returns bigint, not integer -- drop any earlier integer-typed
-- version from a partial run before creating the correctly-typed one.
drop function if exists public.band_cycle_count(integer);
drop function if exists public.band_delivery_count(integer);

create or replace function public.band_cycle_count(n bigint)
returns text language sql immutable as $$
  select case when n = 0 then '0' when n <= 5 then '1-5' when n <= 20 then '6-20' else '21+' end;
$$;

create or replace function public.band_delivery_count(n bigint)
returns text language sql immutable as $$
  select case when n = 0 then '0' when n <= 10 then '1-10' when n <= 50 then '11-50' else '51+' end;
$$;

create or replace function public.platform_feedback_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with entitled_orgs as (
    select e.organization_id, o.name as organization_name
    from public.organization_product_entitlements e
    join public.organizations o on o.id = e.organization_id
    where e.product_key = 'feedback' and e.status in ('trial', 'active')
  ),
  cycle_counts as (
    select
      eo.organization_id,
      count(c.id) as cycles_total,
      count(c.id) filter (where c.status = 'live') as cycles_live
    from entitled_orgs eo
    left join public.feedback_cycles c on c.organization_id = eo.organization_id
    group by eo.organization_id
  ),
  delivery_counts as (
    select
      eo.organization_id,
      count(d.id) filter (where d.sent_at is not null) as deliveries_sent,
      count(d.id) filter (where d.opened_at is not null) as deliveries_opened,
      count(d.id) filter (where d.completed_at is not null) as deliveries_completed
    from entitled_orgs eo
    left join public.feedback_invitation_deliveries d on d.organization_id = eo.organization_id
    group by eo.organization_id
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'platformSummary', jsonb_build_object(
      'organizationsWithFeedbackEnabled', (select count(*) from entitled_orgs),
      'cyclesAcrossPlatform', (select coalesce(sum(cycles_total), 0) from cycle_counts)
    ),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organizationId', eo.organization_id,
        'organizationName', eo.organization_name,
        'cyclesTotal', public.band_cycle_count(coalesce(cc.cycles_total, 0)),
        'cyclesLive', public.band_cycle_count(coalesce(cc.cycles_live, 0)),
        'deliveriesSent', public.band_delivery_count(coalesce(dc.deliveries_sent, 0)),
        'deliveriesOpened', public.band_delivery_count(coalesce(dc.deliveries_opened, 0)),
        'deliveriesCompleted', public.band_delivery_count(coalesce(dc.deliveries_completed, 0))
      ) order by eo.organization_name)
      from entitled_orgs eo
      left join cycle_counts cc on cc.organization_id = eo.organization_id
      left join delivery_counts dc on dc.organization_id = eo.organization_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.band_cycle_count(bigint) from public;
revoke all on function public.band_delivery_count(bigint) from public;
revoke all on function public.platform_feedback_health() from public, authenticated, anon;
