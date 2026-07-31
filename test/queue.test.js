import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueueSnapshot,
  queueInternals,
} from "../src/queue.js";

const NOW = new Date("2026-07-31T05:00:00.000Z");

function job({
  number,
  workflow,
  name,
  status,
  queuedAt,
  startAt,
  stopAt,
  branch,
  subject,
  authorName,
}) {
  return {
    build_num: number,
    status,
    queued_at: queuedAt ?? null,
    start_time: startAt ?? null,
    stop_time: stopAt ?? null,
    branch: branch ?? `pull/${number}/head`,
    subject: subject ?? `Change for ${number}`,
    author_name: authorName ?? `Author ${number}`,
    vcs_revision: String(number).padStart(40, "0"),
    workflows: {
      workflow_id: workflow,
      workflow_name: "build_test",
      job_name: name,
    },
  };
}

function completedWorkflow({
  workflow,
  base,
  shellStart,
  shellStop,
  prepStart,
  prepStop,
}) {
  return [
    job({
      number: base,
      workflow,
      name: "download-build",
      status: "success",
      queuedAt: prepStart,
      startAt: prepStart,
      stopAt: prepStop,
    }),
    job({
      number: base + 1,
      workflow,
      name: "test_shell",
      status: "success",
      queuedAt: shellStart,
      startAt: shellStart,
      stopAt: shellStop,
    }),
  ];
}

test("extracts PR numbers from CircleCI pull branches", () => {
  assert.equal(queueInternals.parsePrNumber("pull/7586/head"), 7586);
  assert.equal(queueInternals.parsePrNumber("pull/7586"), 7586);
  assert.equal(queueInternals.parsePrNumber("develop"), null);
});

test("keeps commit metadata distinct from GitHub PR metadata", () => {
  const builds = completedWorkflow({
    workflow: "metadata",
    base: 700,
    prepStart: "2026-07-31T03:00:00Z",
    prepStop: "2026-07-31T03:10:00Z",
    shellStart: "2026-07-31T03:10:00Z",
    shellStop: "2026-07-31T03:40:00Z",
  });
  builds[1].subject = "Fix the latest edge case";
  builds[1].author_name = "Commit Author";

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.recent[0].prTitle, null);
  assert.equal(snapshot.recent[0].commitMessage, "Fix the latest edge case");
  assert.equal(snapshot.recent[0].commitAuthorName, "Commit Author");
});

test("returns up to 24 recently completed shell workflows", () => {
  const builds = Array.from({ length: 30 }, (_, index) =>
    completedWorkflow({
      workflow: `history-${index}`,
      base: 1_000 + index * 2,
      prepStart: `2026-07-30T${String(index % 24).padStart(2, "0")}:00:00Z`,
      prepStop: `2026-07-30T${String(index % 24).padStart(2, "0")}:10:00Z`,
      shellStart: `2026-07-30T${String(index % 24).padStart(2, "0")}:10:00Z`,
      shellStop: `2026-07-30T${String(index % 24).padStart(2, "0")}:40:00Z`,
    }),
  ).flat();

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.recent.length, 24);
});

test("orders ready preparation tasks before the shell tasks they release", () => {
  const builds = [
    ...completedWorkflow({
      workflow: "history-1",
      base: 10,
      prepStart: "2026-07-31T00:00:00Z",
      prepStop: "2026-07-31T00:10:00Z",
      shellStart: "2026-07-31T00:10:00Z",
      shellStop: "2026-07-31T00:40:00Z",
    }),
    ...completedWorkflow({
      workflow: "history-2",
      base: 20,
      prepStart: "2026-07-31T01:00:00Z",
      prepStop: "2026-07-31T01:10:00Z",
      shellStart: "2026-07-31T01:10:00Z",
      shellStop: "2026-07-31T01:40:00Z",
    }),
    job({
      number: 100,
      workflow: "running",
      name: "download-build",
      status: "success",
      startAt: "2026-07-31T04:30:00Z",
      stopAt: "2026-07-31T04:40:00Z",
    }),
    job({
      number: 101,
      workflow: "running",
      name: "test_shell",
      status: "running",
      queuedAt: "2026-07-31T04:45:00Z",
      startAt: "2026-07-31T04:45:00Z",
    }),
    job({
      number: 200,
      workflow: "waiting-b",
      name: "build_debug",
      status: "success",
      queuedAt: "2026-07-31T04:20:00Z",
      startAt: "2026-07-31T04:20:00Z",
      stopAt: "2026-07-31T04:50:00Z",
      branch: "pull/200/head",
    }),
    job({
      number: 201,
      workflow: "waiting-b",
      name: "download-build",
      status: "not_running",
      branch: "pull/200/head",
    }),
    job({
      number: 300,
      workflow: "waiting-c",
      name: "build_debug",
      status: "success",
      queuedAt: "2026-07-31T04:25:00Z",
      startAt: "2026-07-31T04:25:00Z",
      stopAt: "2026-07-31T04:55:00Z",
      branch: "pull/300/head",
    }),
    job({
      number: 301,
      workflow: "waiting-c",
      name: "download-build",
      status: "not_running",
      branch: "pull/300/head",
    }),
  ];

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.summary.typicalShellDurationSeconds, 1_800);
  assert.equal(snapshot.summary.typicalPreparationDurationSeconds, 600);
  assert.equal(snapshot.running.length, 1);
  assert.deepEqual(
    snapshot.queue.map((entry) => entry.prNumber),
    [200, 300],
  );
  assert.deepEqual(
    snapshot.queue.map((entry) => entry.estimatedStartAt),
    ["2026-07-31T05:35:00.000Z", "2026-07-31T06:05:00.000Z"],
  );
  assert.equal(
    snapshot.summary.estimatedQueueClearAt,
    "2026-07-31T06:35:00.000Z",
  );
});

test("excludes implausibly old running jobs from ETA calculations", () => {
  const builds = [
    job({
      number: 400,
      workflow: "stale",
      name: "test_shell",
      status: "running",
      queuedAt: "2026-07-30T22:00:00Z",
      startAt: "2026-07-30T22:00:00Z",
      branch: "pull/400/head",
    }),
  ];

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.running.length, 0);
  assert.equal(snapshot.queue.length, 0);
  assert.equal(snapshot.anomalies.length, 1);
  assert.equal(snapshot.anomalies[0].kind, "stale_running");
});

test("marks workflows with unfinished build prerequisites as low confidence", () => {
  const builds = [
    job({
      number: 500,
      workflow: "building",
      name: "build_debug",
      status: "running",
      queuedAt: "2026-07-31T04:58:00Z",
      startAt: "2026-07-31T04:58:00Z",
      branch: "pull/500/head",
    }),
    job({
      number: 501,
      workflow: "building",
      name: "download-build",
      status: "not_running",
      branch: "pull/500/head",
    }),
  ];

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.queue.length, 1);
  assert.equal(snapshot.queue[0].phase, "waiting_build");
  assert.equal(snapshot.queue[0].confidence, "low");
  assert.ok(
    new Date(snapshot.queue[0].estimatedStartAt) >
      new Date(snapshot.generatedAt),
  );
});

test("includes a running preparation in the future shell queue", () => {
  const builds = [
    job({
      number: 550,
      workflow: "preparing",
      name: "download-build",
      status: "running",
      queuedAt: "2026-07-31T04:58:00Z",
      startAt: "2026-07-31T04:58:00Z",
      branch: "pull/550/head",
    }),
  ];

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.running.length, 1);
  assert.equal(snapshot.running[0].phase, "preparing");
  assert.equal(snapshot.queue.length, 1);
  assert.equal(snapshot.queue[0].prNumber, 550);
  assert.equal(snapshot.queue[0].position, 1);
  assert.equal(snapshot.summary.waitingCount, 1);
});

test("ignores workflows whose prerequisite build failed", () => {
  const builds = [
    job({
      number: 600,
      workflow: "failed-build",
      name: "build_debug",
      status: "failed",
      queuedAt: "2026-07-31T04:50:00Z",
      startAt: "2026-07-31T04:50:00Z",
      stopAt: "2026-07-31T04:59:00Z",
      branch: "pull/600/head",
    }),
    job({
      number: 601,
      workflow: "failed-build",
      name: "download-build",
      status: "not_running",
      branch: "pull/600/head",
    }),
  ];

  const snapshot = buildQueueSnapshot(builds, { now: NOW });

  assert.equal(snapshot.queue.length, 0);
  assert.equal(snapshot.anomalies.length, 0);
});
