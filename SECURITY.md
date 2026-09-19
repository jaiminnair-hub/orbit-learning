# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.
Use GitHub's private reporting instead: open the **Security** tab of this
repository and choose **Report a vulnerability**. Include what you found, how
to reproduce it, and the impact you expect.

You will get an acknowledgement as soon as the maintainer sees it. This is a
volunteer-maintained project, so there is no guaranteed response time.

## What you are responsible for when you self-host

This software handles personal data (names, emails, learning records). If you
deploy it, **you** are the data controller. In particular:

- Use your own Supabase project and keep `SUPABASE_SECRET_KEY` (and every other
  server key) out of the browser and out of git. Only `NEXT_PUBLIC_*` values
  and Supabase *publishable* keys are meant to be public.
- Review the row-level-security policies in `supabase/migrations/` and the
  tenant-isolation tests in `tests/` before putting real data in.
- Set up your own email sender domain, backups, and privacy notices
  (`docs/COMPETENCY_PRIVACY_NOTICE.md` is a starting point, not legal advice).
- The project has **not** had an independent third-party security audit.
