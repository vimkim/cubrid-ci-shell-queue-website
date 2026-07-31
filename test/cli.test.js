import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCliOutput,
  buildEtaOutput,
  parseCliArguments,
} from "../src/cli.js";

function snapshot() {
  return {
    generatedAt: "2026-07-31T05:00:00.000Z",
    timezone: "Asia/Seoul",
    cache: "miss",
    summary: { waitingCount: 1 },
    running: [],
    queue: [
      {
        prNumber: 7588,
        position: 2,
        phase: "waiting_shell",
        estimatedStartAt: "2026-07-31T05:12:00.001Z",
        estimatedFinishAt: "2026-07-31T06:12:00.001Z",
      },
    ],
    recent: [],
    anomalies: [],
  };
}

test("adds an estimated wait in whole seconds to queued entries", () => {
  const output = buildCliOutput(snapshot());

  assert.equal(output.queue[0].estimatedWaitSeconds, 721);
});

test("renders queue timestamps explicitly as UTC, KST, and epoch seconds", () => {
  const output = buildCliOutput(snapshot());

  assert.deepEqual(output.queue[0].estimatedStartAt, {
    utc: "2026-07-31T05:12:00.001Z",
    kst: "2026-07-31T14:12:00.001+09:00",
    epochSeconds: Math.floor(
      new Date("2026-07-31T05:12:00.001Z").getTime() / 1_000,
    ),
  });
  assert.equal(output.generatedAt.utc, "2026-07-31T05:00:00.000Z");
  assert.equal(output.generatedAt.kst, "2026-07-31T14:00:00.000+09:00");
});

test("returns a focused machine-readable result for one PR", () => {
  const output = buildCliOutput(snapshot(), { prNumber: 7588 });

  assert.equal(output.found, true);
  assert.equal(output.state, "queued");
  assert.equal(output.entry.position, 2);
  assert.equal(output.entry.estimatedWaitSeconds, 721);
});

test("reports a focused PR that is absent from the fetched window", () => {
  const output = buildCliOutput(snapshot(), { prNumber: 9999 });

  assert.equal(output.found, false);
  assert.equal(output.state, "not_found");
  assert.equal(output.entry, null);
});

test("returns only agent-relevant timing fields for an ETA lookup", () => {
  const output = buildEtaOutput(snapshot(), { prNumber: 7588 });

  assert.deepEqual(output, {
    generatedAt: {
      utc: "2026-07-31T05:00:00.000Z",
      kst: "2026-07-31T14:00:00.000+09:00",
      epochSeconds: Math.floor(
        new Date("2026-07-31T05:00:00.000Z").getTime() / 1_000,
      ),
    },
    timezone: "Asia/Seoul",
    prNumber: 7588,
    found: true,
    state: "queued",
    position: 2,
    estimatedWaitSeconds: 721,
    estimatedStart: {
      utc: "2026-07-31T05:12:00.001Z",
      kst: "2026-07-31T14:12:00.001+09:00",
      epochSeconds: Math.floor(
        new Date("2026-07-31T05:12:00.001Z").getTime() / 1_000,
      ),
    },
    estimatedFinish: {
      utc: "2026-07-31T06:12:00.001Z",
      kst: "2026-07-31T15:12:00.001+09:00",
      epochSeconds: Math.floor(
        new Date("2026-07-31T06:12:00.001Z").getTime() / 1_000,
      ),
    },
    confidence: null,
  });
});

test("returns null timing fields when an ETA lookup cannot find the PR", () => {
  const output = buildEtaOutput(snapshot(), { prNumber: 9999 });

  assert.equal(output.found, false);
  assert.equal(output.state, "not_found");
  assert.equal(output.estimatedStart, null);
  assert.equal(output.estimatedFinish, null);
  assert.equal(output.estimatedWaitSeconds, null);
});

test("requires a PR number for an ETA lookup", () => {
  assert.throws(() => buildEtaOutput(snapshot()), /PR number is required/);
});

test("accepts positional and named PR arguments", () => {
  assert.deepEqual(parseCliArguments(["7588"]), {
    prNumber: 7588,
    etaOnly: false,
  });
  assert.deepEqual(parseCliArguments(["#7588"]), {
    prNumber: 7588,
    etaOnly: false,
  });
  assert.deepEqual(parseCliArguments(["--pr", "7588"]), {
    prNumber: 7588,
    etaOnly: false,
  });
  assert.deepEqual(parseCliArguments(["--pr=7588"]), {
    prNumber: 7588,
    etaOnly: false,
  });
  assert.deepEqual(parseCliArguments(["--eta", "7588"]), {
    prNumber: 7588,
    etaOnly: true,
  });
  assert.throws(() => parseCliArguments(["--wat"]), /Unknown argument/);
});
