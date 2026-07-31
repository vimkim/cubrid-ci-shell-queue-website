import assert from "node:assert/strict";
import test from "node:test";

import {
  createQueueService,
  fetchRecentBuilds,
} from "../src/circleci.js";

function response(body, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  };
}

test("fetches paginated builds plus the running filter and deduplicates jobs", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const parsed = new URL(url);
    if (parsed.searchParams.get("filter") === "running") {
      return response([{ build_num: 1 }, { build_num: 99 }]);
    }
    if (parsed.searchParams.get("offset") === "0") {
      return response([{ build_num: 1 }, { build_num: 2 }]);
    }
    return response([{ build_num: 3 }]);
  };

  const builds = await fetchRecentBuilds({
    fetchImpl,
    pages: 2,
    pageSize: 2,
  });

  assert.equal(urls.length, 3);
  assert.deepEqual(
    builds.map((build) => build.build_num),
    [99, 3, 2, 1],
  );
});

test("serves a cached snapshot and falls back to it after refresh failure", async () => {
  let attempts = 0;
  let time = new Date("2026-07-31T05:00:00Z");
  const service = createQueueService({
    loadBuilds: async () => {
      attempts += 1;
      if (attempts > 1) throw new Error("upstream unavailable");
      return [{ build_num: 1 }];
    },
    buildSnapshot: (builds, { now }) => ({
      generatedAt: now.toISOString(),
      count: builds.length,
    }),
    cacheTtlMs: 1_000,
    now: () => time,
  });

  const first = await service();
  const cached = await service();
  time = new Date("2026-07-31T05:00:02Z");
  const stale = await service();

  assert.equal(first.cache, "miss");
  assert.equal(cached.cache, "hit");
  assert.equal(stale.cache, "stale");
  assert.match(stale.warning, /upstream unavailable/);
  assert.equal(attempts, 2);
});

test("reports CircleCI HTTP failures", async () => {
  await assert.rejects(
    () =>
      fetchRecentBuilds({
        fetchImpl: async () =>
          response([], {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          }),
        pages: 1,
        includeRunning: false,
      }),
    /CircleCI returned 429 Too Many Requests/,
  );
});
