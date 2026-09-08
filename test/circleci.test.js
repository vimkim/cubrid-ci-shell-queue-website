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
        retry: { retryDelayMs: 0, sleep: async () => {} },
      }),
    /CircleCI returned 429 Too Many Requests/,
  );
});

test("recovers when one of the parallel page requests fails transiently", async () => {
  const failedOnce = new Set();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const offset = new URL(url).searchParams.get("offset");
    if (offset === "300" && !failedOnce.has(offset)) {
      failedOnce.add(offset);
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      });
      throw error;
    }
    return response([{ build_num: Number(offset ?? 1000) + 1 }]);
  };

  const builds = await fetchRecentBuilds({
    fetchImpl,
    pages: 10,
    pageSize: 100,
    retry: { retryDelayMs: 0, sleep: async () => {} },
  });

  assert.equal(calls, 12);
  assert.ok(builds.some((build) => build.build_num === 301));
});

test("limits how many CircleCI requests are in flight at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return response([{ build_num: inFlight + 1 }]);
  };

  await fetchRecentBuilds({ fetchImpl, pages: 10, concurrency: 4 });

  assert.equal(peak, 4);
});
