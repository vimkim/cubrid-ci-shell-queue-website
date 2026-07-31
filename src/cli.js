function secondsUntil(value, generatedAt) {
  if (!value) return null;
  const milliseconds = new Date(value).getTime() - new Date(generatedAt).getTime();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.ceil(milliseconds / 1_000));
}

function timestamp(value) {
  if (!value) return null;
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return null;

  return {
    utc: new Date(milliseconds).toISOString(),
    kst: new Date(milliseconds + 9 * 60 * 60 * 1_000)
      .toISOString()
      .replace("Z", "+09:00"),
    epochSeconds: Math.floor(milliseconds / 1_000),
  };
}

const ENTRY_TIMESTAMP_FIELDS = [
  "requestedAt",
  "startedAt",
  "finishedAt",
  "estimatedPreparationStartAt",
  "estimatedPreparationFinishAt",
  "estimatedStartAt",
  "estimatedFinishAt",
];

function entryTimestamps(entry) {
  const output = { ...entry };
  for (const field of ENTRY_TIMESTAMP_FIELDS) {
    if (field in output) output[field] = timestamp(output[field]);
  }
  return output;
}

function runningEntry(entry, generatedAt) {
  return {
    ...entry,
    estimatedWaitSeconds:
      entry.phase === "running_shell"
        ? 0
        : secondsUntil(entry.estimatedStartAt, generatedAt),
  };
}

function queuedEntry(entry, generatedAt) {
  return {
    ...entry,
    estimatedWaitSeconds: secondsUntil(entry.estimatedStartAt, generatedAt),
  };
}

export function buildCliOutput(snapshot, { prNumber } = {}) {
  const running = snapshot.running.map((entry) =>
    runningEntry(entry, snapshot.generatedAt),
  );
  const queue = snapshot.queue.map((entry) =>
    queuedEntry(entry, snapshot.generatedAt),
  );
  const output = {
    ...snapshot,
    generatedAt: timestamp(snapshot.generatedAt),
    summary: {
      ...snapshot.summary,
      estimatedQueueClearAt: timestamp(snapshot.summary.estimatedQueueClearAt),
    },
    running: running.map(entryTimestamps),
    queue: queue.map(entryTimestamps),
    recent: snapshot.recent.map(entryTimestamps),
    anomalies: snapshot.anomalies.map(entryTimestamps),
  };

  if (!Number.isFinite(prNumber)) return output;

  const runningShell = output.running.find(
    (entry) => entry.prNumber === prNumber && entry.phase === "running_shell",
  );
  const queued = output.queue.find((entry) => entry.prNumber === prNumber);
  const preparing = output.running.find((entry) => entry.prNumber === prNumber);
  const finished = output.recent.find((entry) => entry.prNumber === prNumber);
  const attention = output.anomalies.find((entry) => entry.prNumber === prNumber);
  const match = runningShell ?? queued ?? preparing ?? finished ?? attention;
  const state = runningShell
    ? "running"
    : queued
      ? "queued"
      : preparing
        ? "preparing"
        : finished
          ? "finished"
          : attention
            ? "attention"
            : "not_found";

  return {
    generatedAt: output.generatedAt,
    timezone: output.timezone,
    cache: output.cache,
    query: { prNumber },
    found: Boolean(match),
    state,
    entry: match ?? null,
  };
}

export function buildEtaOutput(snapshot, { prNumber } = {}) {
  if (!Number.isFinite(prNumber)) {
    throw new Error("A PR number is required for an ETA lookup");
  }

  const focused = buildCliOutput(snapshot, { prNumber });
  return {
    generatedAt: focused.generatedAt,
    timezone: focused.timezone,
    prNumber,
    found: focused.found,
    state: focused.state,
    position: focused.entry?.position ?? null,
    estimatedWaitSeconds: focused.entry?.estimatedWaitSeconds ?? null,
    estimatedStart: focused.entry?.estimatedStartAt ?? null,
    estimatedFinish: focused.entry?.estimatedFinishAt ?? null,
    confidence: focused.entry?.confidence ?? null,
  };
}

export function parseCliArguments(arguments_) {
  let prNumber;
  let etaOnly = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--eta") {
      etaOnly = true;
      continue;
    }

    const value = argument === "--pr" ? arguments_[index + 1] : argument;
    const match = /^(?:--pr=|#)?(\d+)$/.exec(value ?? "");

    if (match) {
      prNumber = Number(match[1]);
      if (argument === "--pr") index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { prNumber, etaOnly };
}
