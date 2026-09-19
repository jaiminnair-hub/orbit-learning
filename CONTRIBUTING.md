# Contributing

Thanks for helping make a free, open learning platform better.

## Set up

```bash
git clone <your fork>
cd orbit-learning
npm install
npx supabase start            # needs Docker
cp .env.example .env.local    # fill in the values printed by `npx supabase status`
npm run dev
npm run seed:demo             # optional: a demo organisation with sample data
```

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm test                      # unit + database tests (starts local Supabase)
npm run test:e2e              # browser tests (builds the app, takes ~10 minutes)
```

Small, focused pull requests are easiest to review. If you are changing the
database, add a **new** migration file in `supabase/migrations/` — never edit an
old one — and keep row-level security on every tenant table.

## Ground rules

- Never commit secrets, `.env*` files (other than `.env.example`), or real
  personal data. Use `example.test` / `example.com` addresses in tests and docs.
- Keep tenant isolation intact: every query must be scoped to the caller's
  organisation, and new tables need RLS plus a test in `tests/`.
- Write accessible UI (keyboard, labels, contrast) — there is an e2e
  accessibility spec you should keep green.

By contributing you agree your work is released under the MIT license.
