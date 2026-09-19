# 360 Feedback — Secure Invitation Delivery

## What this build adds

- Server-issued, one-time reviewer invitation tokens. Only a SHA-256 hash is
  persisted; raw tokens are never stored in Supabase or returned to the browser.
- A server-only Vercel endpoint at `POST /api/feedback-invitations`.
- Authorisation check requiring the requester to hold the Orbit `feedback_admin`
  role in the active organisation.
- Recipient lookup from the private people directory or approved external
  contact list.
- Delivery records, provider message IDs, failure reasons, expiry timestamps,
  and an audit event for each send batch.
- An admin UI control that sends only approved reviewers in a live cycle.
- A private reviewer page at `/orbit-360/review.html`; the token is held in
  the URL fragment, never in a request path or referrer header.

## Required migration

Apply `orbit-foundation/supabase/migrations/20260824000100_feedback_invitation_delivery.sql`
to the **Orbit Platform Foundation** Supabase project. It creates
`feedback_invitation_deliveries` and grants browser read access only to
authorised feedback administrators. All writes are service-only.

Then apply `orbit-foundation/supabase/migrations/20260824000200_feedback_token_reviewer_responses.sql`.
It creates the server-only response store used by private reviewer links.

Finally apply `orbit-foundation/supabase/migrations/20260828000100_feedback_delivery_confidentiality_hardening.sql`.
It de-duplicates any existing active link state, permits only one active
private link for each rater task, and prevents a submitted response being
altered without a future explicit re-open workflow.

## Required Vercel environment variables

Set these only in the **Orbit 360 main Vercel project**:

| Variable | Purpose |
|---|---|
| `ORBIT_SUPABASE_URL` | Orbit Platform Foundation project URL |
| `ORBIT_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase key used only to validate the requester session |
| `ORBIT_SUPABASE_SERVICE_ROLE_KEY` | Server-only key for delivery records and recipient lookup |
| `RESEND_API_KEY` | Transactional-email provider secret |
| `RESEND_FROM_EMAIL` | Verified sender address |
| `ORBIT_FEEDBACK_REVIEW_URL` | Exact HTTPS URL of the future reviewer survey page |
| `ORBIT_FEEDBACK_INVITATIONS_ENABLED` | Keep `false` until the smoke test is approved; set `true` only immediately before a controlled test |
| `ORBIT_FEEDBACK_REVIEW_ENABLED` | Keep `false` until the response migration and private-link smoke test pass |

Never expose the service-role key or raw invitation token in browser JavaScript.

## Activation gate

Do **not** enable invitation sending yet. Enable the reviewer endpoint first,
test one controlled private link, and only then enable delivery for one
approved test reviewer.

Before activation, verify in Preview:

1. An unauthenticated request to `/api/feedback-invitations` is rejected.
2. A non-admin authenticated user is rejected.
3. A draft cycle cannot send invitations.
4. A live cycle with approved reviewers can send exactly one private link per
   selected reviewer.
5. The database contains only token hashes, never raw token values.
6. Provider failure is recorded without exposing recipient data or provider
   response details in the browser.
7. Clearing a saved draft answer removes it from the response store, and a
   submitted reviewer link cannot save or delete answers afterwards.
8. A protected report with an under-threshold anonymous group shows the group
   as withheld without scores, comments, or individual identities.
