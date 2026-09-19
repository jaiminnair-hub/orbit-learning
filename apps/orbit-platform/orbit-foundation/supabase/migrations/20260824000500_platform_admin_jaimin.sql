-- Temporary named platform administrator for Orbit Foundation operations.
-- This is not a customer-organization role and does not change any customer data.
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'owner@example.com'
on conflict (user_id) do nothing;
