function secondsUntil(value, generatedAt) {
  if (!value) return null;
  const milliseconds = new Date(value).getTime() - new Date(generatedAt).getTime();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.ceil(milliseconds / 1_000));
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
  const output = {
    ...snapshot,
    running: snapshot.running.map((entry) =>
      runningEntry(entry, snapshot.generatedAt),
    ),
    queue: snapshot.queue.map((entry) => queuedEntry(entry, snapshot.generatedAt)),
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

export function parseCliArguments(arguments_) {
  let prNumber;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = argument === "--pr" ? arguments_[index + 1] : argument;
    const match = /^(?:--pr=|#)?(\d+)$/.exec(value ?? "");

    if (match) {
      prNumber = Number(match[1]);
      if (argument === "--pr") index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { prNumber };
}
