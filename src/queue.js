const TARGET_JOBS = new Set(["download-build", "test_shell"]);
const BUILD_JOBS = new Set(["build", "build_debug"]);
const TERMINAL_SUCCESS = new Set(["success", "fixed"]);
const TERMINAL_FAILURE = new Set([
  "failed",
  "canceled",
  "cancelled",
  "timedout",
  "infrastructure_fail",
  "not_run",
]);
const TERMINAL = new Set([...TERMINAL_SUCCESS, ...TERMINAL_FAILURE]);

const DEFAULT_SHELL_SECONDS = 60 * 60;
const DEFAULT_PREP_SECONDS = 10 * 60;
const DEFAULT_BUILD_SECONDS = 10 * 60;
const STALE_RUNNING_SECONDS = 3 * 60 * 60;
const MINIMUM_REMAINING_SECONDS = 5 * 60;
const RECENT_HISTORY_LIMIT = 24;

function asDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function iso(date) {
  return date ? date.toISOString() : null;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1_000);
}

function secondsBetween(start, finish) {
  const startDate = asDate(start);
  const finishDate = asDate(finish);
  if (!startDate || !finishDate) return undefined;
  return Math.max(0, (finishDate.getTime() - startDate.getTime()) / 1_000);
}

function median(values, fallback) {
  const sorted = values
    .filter(Number.isFinite)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (sorted.length === 0) return fallback;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle]);
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function jobName(build) {
  return build?.workflows?.job_name;
}

function workflowId(build) {
  return build?.workflows?.workflow_id;
}

function isRunning(build) {
  return build?.status === "running";
}

function isTerminal(build) {
  return TERMINAL.has(build?.status);
}

function isSuccess(build) {
  return TERMINAL_SUCCESS.has(build?.status);
}

function jobStart(build) {
  return asDate(build?.start_time ?? build?.queued_at);
}

function jobFinish(build) {
  return asDate(build?.stop_time);
}

function jobRequestedAt(build) {
  return asDate(build?.queued_at ?? build?.start_time ?? build?.stop_time);
}

function parsePrNumber(branch) {
  const match = /^pull\/(\d+)(?:\/head)?$/.exec(branch ?? "");
  return match ? Number(match[1]) : null;
}

function groupByWorkflow(builds) {
  const workflows = new Map();

  for (const build of builds) {
    const id = workflowId(build);
    if (!id) continue;

    let workflow = workflows.get(id);
    if (!workflow) {
      workflow = { id, jobs: new Map(), allJobs: [] };
      workflows.set(id, workflow);
    }

    workflow.allJobs.push(build);
    const name = jobName(build);
    const current = workflow.jobs.get(name);
    if (!current || (build.build_num ?? 0) > (current.build_num ?? 0)) {
      workflow.jobs.set(name, build);
    }
  }

  return [...workflows.values()];
}

function workflowRequestedAt(workflow) {
  const dates = workflow.allJobs
    .map(jobRequestedAt)
    .filter(Boolean)
    .sort((left, right) => left - right);
  return dates[0];
}

function representativeJob(workflow) {
  return (
    workflow.jobs.get("test_shell") ??
    workflow.jobs.get("download-build") ??
    workflow.allJobs[0]
  );
}

function entryFromWorkflow(workflow) {
  const job = representativeJob(workflow);
  const prNumber = parsePrNumber(job?.branch);

  return {
    workflowId: workflow.id,
    prNumber,
    prUrl: prNumber
      ? `https://github.com/CUBRID/cubrid/pull/${prNumber}`
      : null,
    branch: job?.branch ?? null,
    prTitle: null,
    commitMessage: job?.subject ?? "(commit message unavailable)",
    commitAuthorName: job?.author_name ?? null,
    commit: job?.vcs_revision ?? null,
    requestedAt: iso(workflowRequestedAt(workflow)),
    circleciUrl: job?.build_num
      ? `https://circleci.com/gh/CUBRID/cubrid/${job.build_num}`
      : null,
    shellJobNumber: workflow.jobs.get("test_shell")?.build_num ?? null,
    preparationJobNumber:
      workflow.jobs.get("download-build")?.build_num ?? null,
  };
}

function successfulPrerequisites(workflow) {
  const prerequisites = [...workflow.jobs.values()].filter((job) =>
    BUILD_JOBS.has(jobName(job)),
  );
  return prerequisites.length > 0 && prerequisites.every(isSuccess);
}

function failedPrerequisite(workflow) {
  return [...workflow.jobs.values()].find(
    (job) => BUILD_JOBS.has(jobName(job)) && TERMINAL_FAILURE.has(job.status),
  );
}

function latestPrerequisiteFinish(workflow) {
  const dates = [...workflow.jobs.values()]
    .filter((job) => BUILD_JOBS.has(jobName(job)))
    .map(jobFinish)
    .filter(Boolean)
    .sort((left, right) => right - left);
  return dates[0];
}

function estimatePrerequisiteReadyAt(workflow, now, buildSeconds) {
  if (successfulPrerequisites(workflow)) {
    return latestPrerequisiteFinish(workflow) ?? now;
  }

  const runningBuilds = [...workflow.jobs.values()].filter(
    (job) => BUILD_JOBS.has(jobName(job)) && isRunning(job),
  );
  if (runningBuilds.length > 0) {
    const estimatedFinishes = runningBuilds.map((job) => {
      const start = jobStart(job) ?? now;
      const elapsed = Math.max(0, secondsBetween(start, now) ?? 0);
      return addSeconds(
        start,
        Math.max(buildSeconds, elapsed + MINIMUM_REMAINING_SECONDS),
      );
    });
    return new Date(Math.max(...estimatedFinishes.map((date) => date.getTime())));
  }

  return addSeconds(now, buildSeconds);
}

function observedDurations(workflows, name, { min, max }) {
  return workflows
    .map((workflow) => workflow.jobs.get(name))
    .filter(Boolean)
    .map((job) => secondsBetween(job.start_time, job.stop_time))
    .filter((duration) => duration >= min && duration <= max);
}

function projectedFinish(job, now, typicalSeconds) {
  const start = jobStart(job) ?? now;
  const elapsed = Math.max(0, secondsBetween(start, now) ?? 0);
  return addSeconds(
    start,
    Math.max(typicalSeconds, elapsed + MINIMUM_REMAINING_SECONDS),
  );
}

function taskOrder(left, right) {
  const readyDifference = left.readyAt.getTime() - right.readyAt.getTime();
  if (readyDifference !== 0) return readyDifference;

  const requestDifference =
    left.requestedAt.getTime() - right.requestedAt.getTime();
  if (requestDifference !== 0) return requestDifference;

  return (left.jobNumber ?? Number.MAX_SAFE_INTEGER) -
    (right.jobNumber ?? Number.MAX_SAFE_INTEGER);
}

function publicEntry(entry) {
  const copy = { ...entry };
  delete copy._requestedAt;
  return copy;
}

export function buildQueueSnapshot(builds, { now = new Date() } = {}) {
  const currentTime = asDate(now) ?? new Date();
  const workflows = groupByWorkflow(builds);
  const relevant = workflows.filter(
    (workflow) =>
      workflow.jobs.has("download-build") ||
      workflow.jobs.has("test_shell"),
  );

  const shellDurations = observedDurations(relevant, "test_shell", {
    min: 5 * 60,
    max: 3 * 60 * 60,
  });
  const prepDurations = observedDurations(relevant, "download-build", {
    min: 5,
    max: 2 * 60 * 60,
  });
  const buildDurations = observedDurations(workflows, "build_debug", {
    min: 30,
    max: 2 * 60 * 60,
  });

  const shellSeconds = median(shellDurations, DEFAULT_SHELL_SECONDS);
  const prepSeconds = median(prepDurations, DEFAULT_PREP_SECONDS);
  const buildSeconds = median(buildDurations, DEFAULT_BUILD_SECONDS);

  const anomalies = [];
  const recent = [];
  const entries = new Map();
  const runningTasks = [];
  const pendingTasks = [];

  for (const workflow of relevant) {
    const shell = workflow.jobs.get("test_shell");
    const preparation = workflow.jobs.get("download-build");
    const entry = {
      ...entryFromWorkflow(workflow),
      phase: "waiting_build",
      status: "waiting",
      confidence: "low",
      estimatedPreparationStartAt: null,
      estimatedPreparationFinishAt: null,
      estimatedStartAt: null,
      estimatedFinishAt: null,
      _requestedAt: workflowRequestedAt(workflow) ?? currentTime,
    };

    if (shell && isTerminal(shell)) {
      recent.push({
        ...publicEntry(entry),
        status: shell.status,
        phase: "complete",
        startedAt: iso(jobStart(shell)),
        finishedAt: iso(jobFinish(shell)),
        durationSeconds:
          secondsBetween(shell.start_time, shell.stop_time) ?? null,
        circleciUrl: `https://circleci.com/gh/CUBRID/cubrid/${shell.build_num}`,
      });
      continue;
    }

    const prerequisiteFailure = failedPrerequisite(workflow);
    if (prerequisiteFailure && !isRunning(shell)) {
      continue;
    }

    const runningTarget = [preparation, shell].find(isRunning);
    if (runningTarget) {
      const startedAt = jobStart(runningTarget) ?? currentTime;
      const ageSeconds = secondsBetween(startedAt, currentTime) ?? 0;
      if (ageSeconds > STALE_RUNNING_SECONDS) {
        anomalies.push({
          ...publicEntry(entry),
          kind: "stale_running",
          message: `${jobName(runningTarget)} has reported running for ${Math.floor(ageSeconds / 3_600)} hours and is excluded from ETA calculations.`,
          circleciUrl: `https://circleci.com/gh/CUBRID/cubrid/${runningTarget.build_num}`,
        });
        continue;
      }

      const taskKind = jobName(runningTarget) === "test_shell" ? "shell" : "prep";
      const duration = taskKind === "shell" ? shellSeconds : prepSeconds;
      const finishAt = projectedFinish(
        runningTarget,
        currentTime,
        duration,
      );

      entry.phase = taskKind === "shell" ? "running_shell" : "preparing";
      entry.status = "running";
      entry.confidence = "medium";
      entry.startedAt = iso(startedAt);
      if (taskKind === "shell") {
        entry.estimatedStartAt = iso(startedAt);
        entry.estimatedFinishAt = iso(finishAt);
      } else {
        entry.estimatedPreparationStartAt = iso(startedAt);
        entry.estimatedPreparationFinishAt = iso(finishAt);
      }
      entries.set(workflow.id, entry);
      runningTasks.push({
        kind: taskKind,
        workflowId: workflow.id,
        finishAt,
      });
      continue;
    }

    if (preparation && TERMINAL_FAILURE.has(preparation.status)) {
      continue;
    }

    entries.set(workflow.id, entry);

    if (preparation && isSuccess(preparation)) {
      entry.phase = "waiting_shell";
      entry.confidence = "high";
      pendingTasks.push({
        kind: "shell",
        workflowId: workflow.id,
        readyAt: jobRequestedAt(shell) ?? jobFinish(preparation) ?? currentTime,
        requestedAt: entry._requestedAt,
        jobNumber: shell?.build_num,
      });
      continue;
    }

    const prerequisitesReady = successfulPrerequisites(workflow);
    const readyAt = estimatePrerequisiteReadyAt(
      workflow,
      currentTime,
      buildSeconds,
    );
    entry.phase = prerequisitesReady
      ? "waiting_preparation"
      : "waiting_build";
    entry.confidence = prerequisitesReady ? "medium" : "low";
    pendingTasks.push({
      kind: "prep",
      workflowId: workflow.id,
      readyAt,
      requestedAt: entry._requestedAt,
      jobNumber: preparation?.build_num,
    });
  }

  let cursor =
    runningTasks.length > 0
      ? new Date(
          Math.max(...runningTasks.map((task) => task.finishAt.getTime())),
        )
      : currentTime;

  for (const task of runningTasks) {
    if (task.kind !== "prep") continue;
    pendingTasks.push({
      kind: "shell",
      workflowId: task.workflowId,
      readyAt: task.finishAt,
      requestedAt:
        entries.get(task.workflowId)?._requestedAt ?? currentTime,
      jobNumber: entries.get(task.workflowId)?.shellJobNumber,
    });
  }

  while (pendingTasks.length > 0) {
    pendingTasks.sort(taskOrder);
    const task = pendingTasks.shift();
    const entry = entries.get(task.workflowId);
    if (!entry) continue;

    const startAt = new Date(
      Math.max(cursor.getTime(), task.readyAt.getTime()),
    );
    const duration = task.kind === "shell" ? shellSeconds : prepSeconds;
    const finishAt = addSeconds(startAt, duration);
    cursor = finishAt;

    if (task.kind === "prep") {
      entry.estimatedPreparationStartAt = iso(startAt);
      entry.estimatedPreparationFinishAt = iso(finishAt);
      pendingTasks.push({
        kind: "shell",
        workflowId: task.workflowId,
        readyAt: finishAt,
        requestedAt: entry._requestedAt,
        jobNumber: entry.shellJobNumber,
      });
    } else {
      entry.estimatedStartAt = iso(startAt);
      entry.estimatedFinishAt = iso(finishAt);
    }
  }

  const running = [...entries.values()]
    .filter((entry) => entry.status === "running")
    .sort(
      (left, right) =>
        new Date(left.startedAt).getTime() -
        new Date(right.startedAt).getTime(),
    )
    .map(publicEntry);

  const queue = [...entries.values()]
    .filter(
      (entry) =>
        entry.status === "waiting" ||
        (entry.status === "running" && entry.phase === "preparing"),
    )
    .sort(
      (left, right) =>
        new Date(left.estimatedStartAt).getTime() -
        new Date(right.estimatedStartAt).getTime(),
    )
    .map((entry, index) =>
      publicEntry({
        ...entry,
        position: index + 1,
      }),
    );

  recent.sort(
    (left, right) =>
      new Date(right.finishedAt).getTime() -
      new Date(left.finishedAt).getTime(),
  );

  const queueClearAt =
    queue.length > 0
      ? queue[queue.length - 1].estimatedFinishAt
      : running.length > 0
        ? running
            .map((entry) => entry.estimatedFinishAt)
            .filter(Boolean)
            .sort()
            .at(-1)
        : iso(currentTime);

  return {
    generatedAt: iso(currentTime),
    timezone: "Asia/Seoul",
    source: {
      project: "CUBRID/cubrid",
      api: "CircleCI v1.1 public API",
      authentication: "none",
      ordering: "estimated",
    },
    summary: {
      runnerStatus:
        running.find((entry) => entry.phase === "running_shell")
          ? "running_shell"
          : running.length > 0
            ? "preparing"
            : "idle",
      runningCount: running.length,
      waitingCount: queue.length,
      typicalShellDurationSeconds: shellSeconds,
      typicalPreparationDurationSeconds: prepSeconds,
      durationSampleSize: shellDurations.length,
      estimatedQueueClearAt: queueClearAt,
    },
    running,
    queue,
    recent: recent.slice(0, RECENT_HISTORY_LIMIT),
    anomalies,
    estimateNote:
      "Positions and times are inferred from public workflow status, dependency readiness, and recent median durations. CircleCI does not publish a canonical per-job runner order.",
  };
}

export const queueInternals = {
  median,
  parsePrNumber,
  secondsBetween,
};
