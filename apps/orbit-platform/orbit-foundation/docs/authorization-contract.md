# Orbit authorization contract

This contract is the rule every future LMS, Feedback, Growth, and Competency
route, screen, query, and RLS policy must follow.

## The three required answers

Before an authenticated user receives product data, all three answers must be
yes:

1. Is the person an **active member** of the selected organization?
2. Does the organization have an **active or trial entitlement** for the
   requested product, in its valid date window?
3. Does the person hold a non-expired **role for that product**?

The platform helper is:

```sql
public.can_access_product(product_key, required_role_key, organization_id)
```

A product table must pair this broad product access check with its own
resource-level rule. Examples:

- Feedback must additionally confirm the user is an assigned reviewer, subject,
  coach, or authorized report viewer for that specific cycle/report.
- LMS must additionally confirm the learner is enrolled in that specific course
  or the assigned LMS role permits administration.

## Organization context

`public.current_organization_id()` is the only organization context used by
RLS. It reads `user_active_organizations` and confirms active membership every
time, so suspending a membership immediately invalidates a previously selected
organization.

The only browser-callable way to switch organizations is:

```sql
select public.set_active_organization('<organization uuid>');
```

It rejects organizations the caller does not actively belong to.

## Explicitly excluded shortcuts

- An `org_admin` does not automatically see Feedback reports or LMS content.
- A purchased product does not automatically grant every employee access.
- A platform admin does not receive implicit browser-level cross-tenant data
  access. Support actions must run server-side and create an audit event.
- Feedback reviewer, subject, and coach assignments belong to Feedback cycle
  tables. They are not permanent global roles.

## Subscription status

`trial` and `active` entitlements allow product access. `suspended` and
`cancelled` do not. The application may show an enable-product/read-only page,
but APIs and RLS must deny product data changes regardless of UI state.

The commercial policy is a 30-day read-only grace period for payment failure.
That policy will be implemented through dedicated entitlement fields and
product-specific write policies in the billing phase; it is not silently
assumed by this baseline.
