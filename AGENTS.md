<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Mandatory lean-work rule

- Read only the files and schema sections directly required by the active task.
- Do not load broad documentation, dump large schemas, audit unrelated areas, or expand the agreed scope.
- For cross-product work, change only the database and application surfaces required for the named end-to-end flow.
- Verify with focused checks first; run broader checks once at the release boundary.
