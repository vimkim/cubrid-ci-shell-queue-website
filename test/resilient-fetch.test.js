import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchWithRetry,
  isTransientFetchError,
  mapWithConcurrency,
} from "../src/resilient-fetch.js";

function networkFailure(code = "UND_ERR_CONNECT_TIMEOUT") {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error("Connect Timeout Error"), { code });
  return error;
}

function response(status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "" };
}

test("retries a request that fails with a network error and then succeeds", async () => {
  let calls = 0;
  const delays = [];
  const result = await fetchWithRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw networkFailure();
      return response(200);
    },
    "https://example.test/",
    {},
    { attempts: 3, retryDelayMs: 250, sleep: async (ms) => delays.push(ms) },
  );

  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("gives up after the configured attempts and rethrows the last error", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchWithRetry(
        async () => {
          calls += 1;
          throw networkFailure("ECONNRESET");
        },
        "https://example.test/",
        {},
        { attempts: 3, retryDelayMs: 0, sleep: async () => {} },
      ),
    /fetch failed/,
  );
  assert.equal(calls, 3);
});

test("does not retry client errors such as 404", async () => {
  let calls = 0;
  const result = await fetchWithRetry(
    async () => {
      calls += 1;
      return response(404);
    },
    "https://example.test/",
    {},
    { attempts: 3, retryDelayMs: 0, sleep: async () => {} },
  );

  assert.equal(result.status, 404);
  assert.equal(calls, 1);
});

test("retries retryable HTTP statuses such as 503 and 429", async () => {
  const statuses = [503, 429, 200];
  let calls = 0;
  const result = await fetchWithRetry(
    async () => {
      calls += 1;
      return response(statuses.shift());
    },
    "https://example.test/",
    {},
    { attempts: 3, retryDelayMs: 0, sleep: async () => {} },
  );

  assert.equal(result.status, 200);
  assert.equal(calls, 3);
});

test("stops retrying once the caller has aborted", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    () =>
      fetchWithRetry(
        async () => {
          calls += 1;
          controller.abort();
          throw new DOMException("The operation was aborted.", "AbortError");
        },
        "https://example.test/",
        { signal: controller.signal },
        { attempts: 3, retryDelayMs: 0, sleep: async () => {} },
      ),
    /aborted/,
  );
  assert.equal(calls, 1);
});

test("recognizes undici network failures as transient", () => {
  assert.equal(isTransientFetchError(networkFailure()), true);
  assert.equal(isTransientFetchError(new Error("CircleCI returned 404")), false);
});

test("runs at most the configured number of workers at once and keeps order", async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency(
    Array.from({ length: 11 }, (_, index) => index),
    4,
    async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value * 10;
    },
  );

  assert.equal(peak, 4);
  assert.deepEqual(
    results,
    Array.from({ length: 11 }, (_, index) => index * 10),
  );
});
