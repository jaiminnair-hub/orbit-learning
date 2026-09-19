"use client";

import { useEffect, useState } from "react";

/**
 * Resolves a `content_assets` id to a short-lived signed URL, via the same
 * route the Phase 2 player already uses
 * (app/api/v1/content/assets/[id]/url/route.ts) — no new signing path, no
 * new bucket policy, just reused from the block renderers.
 *
 * Module-level cache so the same asset referenced by multiple blocks on a
 * page (or revisited after navigating back) doesn't re-fetch a fresh signed
 * URL every render.
 */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * Test-only seam: `renderToStaticMarkup` never flushes effects, so a test
 * asserting on rendered `<img>`/`<video>`/`<audio>` output has to seed the
 * resolved URL synchronously before rendering rather than exercise the real
 * fetch. Exported (not module-private) for exactly that use from
 * tests/runtime/blocks.test.ts — not used by application code.
 */
export const assetUrlCacheForTests = cache;

async function fetchUrl(assetId: string): Promise<string | null> {
  if (cache.has(assetId)) return cache.get(assetId)!;
  const existing = inflight.get(assetId);
  if (existing) return existing;

  const promise = fetch(`/api/v1/content/assets/${assetId}/url`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json: { data?: { url?: string } } | null) => {
      const url = json?.data?.url ?? null;
      if (url) cache.set(assetId, url);
      return url;
    })
    .catch(() => null)
    .finally(() => inflight.delete(assetId));

  inflight.set(assetId, promise);
  return promise;
}

export function useAssetUrl(assetId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(assetId ? (cache.get(assetId) ?? null) : null);

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    fetchUrl(assetId).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return assetId ? url : null;
}
