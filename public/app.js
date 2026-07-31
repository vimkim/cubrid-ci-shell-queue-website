const elements = {
  liveStatus: document.querySelector("#live-status"),
  liveStatusText: document.querySelector("#live-status-text"),
  refreshButton: document.querySelector("#refresh-button"),
  search: document.querySelector("#queue-search"),
  runnerStatus: document.querySelector("#runner-status"),
  runnerDetail: document.querySelector("#runner-detail"),
  waitingCount: document.querySelector("#waiting-count"),
  typicalDuration: document.querySelector("#typical-duration"),
  durationSample: document.querySelector("#duration-sample"),
  queueClear: document.querySelector("#queue-clear"),
  updatedAt: document.querySelector("#updated-at"),
  runningContent: document.querySelector("#running-content"),
  queueCountBadge: document.querySelector("#queue-count-badge"),
  queueBody: document.querySelector("#queue-body"),
  mobileQueue: document.querySelector("#mobile-queue"),
  queueEmpty: document.querySelector("#queue-empty"),
  recentList: document.querySelector("#recent-list"),
  attentionPanel: document.querySelector("#attention-panel"),
  attentionList: document.querySelector("#attention-list"),
  errorBanner: document.querySelector("#error-banner"),
  errorMessage: document.querySelector("#error-message"),
  announcement: document.querySelector("#live-announcement"),
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

let snapshot;
let countdownTimer;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

function formatTime(value) {
  if (!value) return "—";
  return timeFormatter.format(new Date(value));
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return "—";
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function relativeTime(value, reference = new Date()) {
  if (!value) return "—";
  const seconds = Math.round(
    (new Date(value).getTime() - reference.getTime()) / 1_000,
  );
  const absolute = Math.abs(seconds);

  if (absolute < 45) return seconds >= 0 ? "in a moment" : "just now";
  if (absolute < 3_600) {
    const minutes = Math.round(absolute / 60);
    return seconds >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  }
  const hours = Math.round(absolute / 3_600);
  return seconds >= 0 ? `in ${hours}h` : `${hours}h ago`;
}

function phaseInfo(phase) {
  return (
    {
      running_shell: { label: "Running shell", className: "" },
      preparing: { label: "Preparing build", className: "phase-build" },
      waiting_shell: { label: "Shell ready", className: "" },
      waiting_preparation: {
        label: "Waiting for runner",
        className: "phase-build",
      },
      waiting_build: { label: "Building", className: "phase-build" },
    }[phase] ?? { label: phase, className: "" }
  );
}

function prLabel(entry) {
  return entry.prNumber ? `PR #${entry.prNumber}` : entry.branch || "Workflow";
}

function prAnchor(entry, className = "") {
  const label = escapeHtml(prLabel(entry));
  if (!entry.prUrl) return `<span class="${className}">${label}</span>`;
  return `<a class="${className}" href="${safeUrl(entry.prUrl)}" target="_blank" rel="noreferrer">${label}</a>`;
}

function circleLink(entry) {
  if (!entry.circleciUrl) return "";
  return `<a href="${safeUrl(entry.circleciUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(prLabel(entry))} in CircleCI">CircleCI ↗</a>`;
}

function renderSummary(data) {
  const activeShell = data.running.find(
    (entry) => entry.phase === "running_shell",
  );
  const activePreparation = data.running.find(
    (entry) => entry.phase === "preparing",
  );
  const preparationCount = data.running.filter(
    (entry) => entry.phase === "preparing",
  ).length;

  if (activeShell) {
    elements.runnerStatus.textContent = "Running shell";
    elements.runnerDetail.textContent = prLabel(activeShell);
  } else if (activePreparation) {
    elements.runnerStatus.textContent = "Preparing";
    elements.runnerDetail.textContent =
      preparationCount > 1
        ? `${preparationCount} download-build jobs`
        : prLabel(activePreparation);
  } else {
    elements.runnerStatus.textContent = "Idle";
    elements.runnerDetail.textContent = "No active runner task";
  }

  elements.waitingCount.textContent = String(data.summary.waitingCount);
  elements.typicalDuration.textContent = formatDuration(
    data.summary.typicalShellDurationSeconds,
  );
  elements.durationSample.textContent = data.summary.durationSampleSize
    ? `median of ${data.summary.durationSampleSize} recent runs`
    : "default estimate";
  elements.queueClear.textContent = formatTime(
    data.summary.estimatedQueueClearAt,
  );
  elements.updatedAt.textContent = "Updated just now";
  elements.queueCountBadge.textContent = `${data.summary.waitingCount} ${
    data.summary.waitingCount === 1 ? "job" : "jobs"
  }`;
}

function renderRunning(data) {
  if (data.running.length === 0) {
    elements.runningContent.innerHTML = `
      <div class="idle-state">
        <span class="idle-icon" aria-hidden="true">✓</span>
        <div>
          <strong>The shared runner is idle</strong>
          <span>${data.queue.length ? "The next ready task should start shortly." : "No active or waiting shell requests were found."}</span>
        </div>
      </div>
    `;
    return;
  }

  elements.runningContent.innerHTML = data.running
    .map((entry) => {
      const phase = phaseInfo(entry.phase);
      const start = new Date(entry.startedAt).getTime();
      const finish = new Date(
        entry.phase === "running_shell"
          ? entry.estimatedFinishAt
          : entry.estimatedPreparationFinishAt,
      ).getTime();
      const elapsed = Date.now() - start;
      const duration = Math.max(1, finish - start);
      const progress = Math.min(96, Math.max(3, (elapsed / duration) * 100));
      const estimatedFinish =
        entry.phase === "running_shell"
          ? entry.estimatedFinishAt
          : entry.estimatedPreparationFinishAt;

      return `
        <article class="running-job">
          <div>
            <div class="job-heading">
              ${prAnchor(entry)}
              <span class="status-pill">● Running</span>
              <span class="phase-pill ${phase.className}">${escapeHtml(phase.label)}</span>
            </div>
            <p class="job-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</p>
            <div class="progress-track" aria-label="Estimated job progress">
              <div class="progress-value" style="width:${progress.toFixed(1)}%"></div>
            </div>
            <div class="running-times">
              <span>Started ${formatTime(entry.startedAt)}</span>
              <span>${circleLink(entry)}</span>
            </div>
          </div>
          <div class="finish-block">
            <span>Estimated finish</span>
            <strong>${formatTime(estimatedFinish)}</strong>
            <span>${relativeTime(estimatedFinish)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function queueRow(entry, search) {
  const phase = phaseInfo(entry.phase);
  const matches =
    search &&
    [entry.prNumber, entry.branch, entry.title]
      .filter(Boolean)
      .some((value) =>
        String(value).toLowerCase().includes(search.toLowerCase()),
      );

  return `
    <tr data-searchable="${escapeHtml(
      [entry.prNumber, entry.branch, entry.title].filter(Boolean).join(" "),
    )}" class="${matches ? "is-match" : ""}">
      <td class="order-cell"><span class="order-number">${entry.position}</span></td>
      <td class="pr-cell">
        ${prAnchor(entry, "pr-link")}
        <span class="pr-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</span>
      </td>
      <td><span class="phase-pill ${phase.className}">${escapeHtml(phase.label)}</span></td>
      <td class="time-cell">
        <strong>${formatTime(entry.estimatedStartAt)}</strong>
        <span>${relativeTime(entry.estimatedStartAt)}</span>
      </td>
      <td class="time-cell">
        <strong>${formatTime(entry.estimatedFinishAt)}</strong>
        <span>${formatDateTime(entry.estimatedFinishAt)}</span>
      </td>
    </tr>
  `;
}

function mobileQueueCard(entry, search) {
  const phase = phaseInfo(entry.phase);
  const matches =
    search &&
    [entry.prNumber, entry.branch, entry.title]
      .filter(Boolean)
      .some((value) =>
        String(value).toLowerCase().includes(search.toLowerCase()),
      );

  return `
    <article class="mobile-queue-card ${matches ? "is-match" : ""}">
      <div class="mobile-queue-top">
        <span>
          <span class="order-number">${entry.position}</span>
          ${prAnchor(entry, "pr-link")}
        </span>
        <span class="phase-pill ${phase.className}">${escapeHtml(phase.label)}</span>
      </div>
      <p class="mobile-queue-title">${escapeHtml(entry.title)}</p>
      <div class="mobile-queue-times">
        <span class="mobile-time">
          Est. start
          <strong>${formatTime(entry.estimatedStartAt)}</strong>
        </span>
        <span class="mobile-time">
          Est. finish
          <strong>${formatTime(entry.estimatedFinishAt)}</strong>
        </span>
      </div>
    </article>
  `;
}

function renderQueue(data) {
  const search = elements.search.value.trim().replace(/^#/, "");
  elements.queueEmpty.hidden = data.queue.length > 0;

  if (data.queue.length === 0) {
    elements.queueBody.innerHTML = "";
    elements.mobileQueue.innerHTML = "";
    return;
  }

  elements.queueBody.innerHTML = data.queue
    .map((entry) => queueRow(entry, search))
    .join("");
  elements.mobileQueue.innerHTML = data.queue
    .map((entry) => mobileQueueCard(entry, search))
    .join("");

  if (search) {
    const match = data.queue.find((entry) =>
      [entry.prNumber, entry.branch, entry.title]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(search.toLowerCase()),
        ),
    );
    elements.announcement.textContent = match
      ? `${prLabel(match)} is estimated at queue position ${match.position}, starting at ${formatTime(match.estimatedStartAt)}.`
      : `No queued pull request matches ${search}.`;
  }
}

function renderRecent(data) {
  if (data.recent.length === 0) {
    elements.recentList.innerHTML =
      '<div class="attention-item"><span>No recent shell jobs found.</span></div>';
    return;
  }

  elements.recentList.innerHTML = data.recent
    .slice(0, 6)
    .map(
      (entry) => `
        <div class="compact-item">
          <div>
            ${prAnchor(entry)}
            <span class="compact-meta">${formatTime(entry.finishedAt)} · ${formatDuration(entry.durationSeconds)}</span>
          </div>
          <span class="result-pill result-${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>
        </div>
      `,
    )
    .join("");
}

function renderAttention(data) {
  elements.attentionPanel.hidden = data.anomalies.length === 0;
  elements.attentionList.innerHTML = data.anomalies
    .map(
      (entry) => `
        <div class="attention-item">
          <strong>${escapeHtml(prLabel(entry))}</strong>
          <span>${escapeHtml(entry.message)}</span>
        </div>
      `,
    )
    .join("");
}

function render(data) {
  snapshot = data;
  renderSummary(data);
  renderRunning(data);
  renderQueue(data);
  renderRecent(data);
  renderAttention(data);

  const isStale = data.cache === "stale";
  elements.liveStatus.classList.toggle("is-live", !isStale);
  elements.liveStatus.classList.toggle("is-error", isStale);
  elements.liveStatusText.textContent = isStale ? "Cached data" : "Live";
  elements.errorBanner.hidden = !data.warning;
  elements.errorMessage.textContent = data.warning || "";
}

async function loadQueue({ force = false } = {}) {
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add("is-loading");

  try {
    const response = await fetch(`/api/queue${force ? "?refresh=1" : ""}`, {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.detail || body.error || `HTTP ${response.status}`);
    }
    render(body);
  } catch (error) {
    elements.liveStatus.classList.remove("is-live");
    elements.liveStatus.classList.add("is-error");
    elements.liveStatusText.textContent = "Unavailable";
    elements.errorBanner.hidden = false;
    elements.errorMessage.textContent = error.message;
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove("is-loading");
  }
}

elements.refreshButton.addEventListener("click", () =>
  loadQueue({ force: true }),
);
elements.search.addEventListener("input", () => {
  if (snapshot) renderQueue(snapshot);
});

loadQueue();
countdownTimer = window.setInterval(() => loadQueue(), 30_000);

window.addEventListener("beforeunload", () => {
  window.clearInterval(countdownTimer);
});
