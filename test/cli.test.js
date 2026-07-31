import assert from "node:assert/strict";
import test from "node:test";

import { buildCliOutput, parseCliArguments } from "../src/cli.js";

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

test("accepts positional and named PR arguments", () => {
  assert.deepEqual(parseCliArguments(["7588"]), { prNumber: 7588 });
  assert.deepEqual(parseCliArguments(["#7588"]), { prNumber: 7588 });
  assert.deepEqual(parseCliArguments(["--pr", "7588"]), { prNumber: 7588 });
  assert.deepEqual(parseCliArguments(["--pr=7588"]), { prNumber: 7588 });
  assert.throws(() => parseCliArguments(["--wat"]), /Unknown argument/);
});
