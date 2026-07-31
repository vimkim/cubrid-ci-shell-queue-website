import assert from "node:assert/strict";
import test from "node:test";

import {
  createPullRequestService,
  enrichQueueSnapshot,
  fetchRecentPullRequests,
} from "../src/github.js";

function response(body, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  };
}

test("fetches and normalizes paginated GitHub pull request metadata", async () => {
  const urls = [];
  const pullRequests = await fetchRecentPullRequests({
    fetchImpl: async (url) => {
      urls.push(new URL(url));
      return response([
        {
          number: Number(new URL(url).searchParams.get("page")),
          title: "A PR title",
          html_url: "https://github.com/CUBRID/cubrid/pull/1",
          user: {
            login: "octocat",
            html_url: "https://github.com/octocat",
          },
        },
      ]);
    },
    pages: 2,
    pageSize: 50,
    token: "test-token",
  });

  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("state"), "all");
  assert.equal(urls[0].searchParams.get("per_page"), "50");
  assert.deepEqual(pullRequests[0], {
    number: 1,
    title: "A PR title",
    url: "https://github.com/CUBRID/cubrid/pull/1",
    authorLogin: "octocat",
    authorUrl: "https://github.com/octocat",
  });
});

test("enriches entries in every snapshot section", () => {
  const entry = {
    prNumber: 7588,
    prUrl: "https://github.com/CUBRID/cubrid/pull/7588",
    prTitle: null,
  };
  const snapshot = {
    running: [entry],
    queue: [entry],
    recent: [entry],
    anomalies: [entry],
  };

  const enriched = enrichQueueSnapshot(snapshot, [
    {
      number: 7588,
      title: "Real PR title",
      url: entry.prUrl,
      authorLogin: "vimkim",
      authorUrl: "https://github.com/vimkim",
    },
  ]);

  for (const section of ["running", "queue", "recent", "anomalies"]) {
    assert.equal(enriched[section][0].prTitle, "Real PR title");
    assert.equal(enriched[section][0].githubAuthorLogin, "vimkim");
  }
});

test("caches GitHub metadata and uses stale data after a refresh failure", async () => {
  let attempts = 0;
  let time = new Date("2026-07-31T05:00:00Z");
  const service = createPullRequestService({
    loadPullRequests: async () => {
      attempts += 1;
      if (attempts > 1) throw new Error("rate limited");
      return [{ number: 1 }];
    },
    cacheTtlMs: 1_000,
    now: () => time,
  });

  const first = await service();
  const cached = await service();
  time = new Date("2026-07-31T05:00:02Z");
  const stale = await service();

  assert.equal(first, cached);
  assert.equal(first, stale);
  assert.equal(attempts, 2);
});
