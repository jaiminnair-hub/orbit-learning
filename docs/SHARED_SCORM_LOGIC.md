# Sharing the pure SCORM logic — proposal, not implemented

**Status:** proposal only. `tests/scorm/content-origin-parity.test.ts` is the automated guard in place today; this document is the longer-term alternative to that guard, for when it's worth the structural change.

## The current state

`apps/scorm-content/lib/{adapter,cmi,bridge-token}.ts` are hand-made copies of `lib/scorm/{adapter,cmi,bridge-token}.ts`. This was a deliberate MVP choice (`docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md`): all three files are pure TypeScript with zero framework or DOM dependency, so duplicating them cost nothing to build and let the isolation work land without also converting the repo into an npm-workspaces monorepo.

The risk that trade accepts: the two copies could silently drift. `content-origin-parity.test.ts` closes that risk today by stripping comments from both copies of each file and asserting the remaining code is byte-identical — verified to actually catch a real divergence (a line deliberately added to one copy failed the test with a clear diff, then passed again once reverted). That test runs in the main `npm test` suite, so any PR that edits one copy without the other fails CI immediately.

## The proposed alternative: an npm workspace

Convert the repo to npm workspaces, with the shared logic pulled into its own package:

```
package.json                 (add "workspaces": ["apps/*", "packages/*"])
packages/scorm-core/
  package.json                (name: "@lms/scorm-core", zero dependencies)
  adapter.ts
  cmi.ts
  bridge-token.ts
apps/scorm-content/
  package.json                (dependency: "@lms/scorm-core": "workspace:*")
```

The main app and `apps/scorm-content` both depend on `@lms/scorm-core` instead of each holding their own copy. One source, imported twice — the parity question stops being something to test for, because there's nothing left that could drift.

### Why this wasn't done as part of the isolation work itself

- It changes root `package.json` and the install/build graph for the *entire* repo, not just the new isolation surface — a larger blast radius than the security fix itself needed.
- `tsconfig.json`'s `exclude: [..., "apps"]` (added this session, for a real reason — see the Turbopack-root bug documented in the isolation commit) would need revisiting, since a shared package both apps import from has to be resolvable by both apps' TypeScript configs simultaneously.
- CI (`ci.yml`) would need an `npm install` at the workspace root to also cover `apps/scorm-content`'s dependencies, rather than that app installing independently the way it does today.

None of that is hard, but it's a deliberate, separately-reviewable change — not something to fold into a security-fix commit.

### When to actually do this

Once `apps/scorm-content` is a second real Vercel project with real traffic (see `docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md`'s rollout gates), or the first time the parity test's diff shows the two copies were *supposed* to diverge and someone has to reason about why they're allowed to — whichever comes first. Until then, the parity test is a fully sufficient guard for three small, rarely-touched files.
