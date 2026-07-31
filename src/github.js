const DEFAULT_API = "https://api.github.com/repos/CUBRID/cubrid/pulls";

function githubHeaders(token) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "cubrid-ci-shell-queue/1.0",
    "x-github-api-version": "2022-11-28",
  };

  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchRecentPullRequests({
  fetchImpl = fetch,
  apiUrl = DEFAULT_API,
  pages = 2,
  pageSize = 100,
  token = process.env.GITHUB_TOKEN,
  signal,
} = {}) {
  const requests = Array.from({ length: pages }, (_, page) => {
    const url = new URL(apiUrl);
    url.searchParams.set("state", "all");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", String(pageSize));
    url.searchParams.set("page", String(page + 1));

    return fetchImpl(url, {
      headers: githubHeaders(token),
      signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `GitHub returned ${response.status} ${response.statusText}`.trim(),
        );
      }

      const body = await response.json();
      if (!Array.isArray(body)) {
        throw new Error("GitHub returned an unexpected response");
      }
      return body;
    });
  });

  const pullRequests = (await Promise.all(requests)).flat();
  return pullRequests
    .filter((pullRequest) => Number.isFinite(pullRequest?.number))
    .map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title ?? null,
      url: pullRequest.html_url ?? null,
      authorLogin: pullRequest.user?.login ?? null,
      authorUrl: pullRequest.user?.html_url ?? null,
    }));
}

export function enrichQueueSnapshot(snapshot, pullRequests) {
  const byNumber = new Map(
    pullRequests.map((pullRequest) => [pullRequest.number, pullRequest]),
  );

  function enrichEntry(entry) {
    const pullRequest = byNumber.get(entry.prNumber);
    if (!pullRequest) return entry;

    return {
      ...entry,
      prTitle: pullRequest.title,
      prUrl: pullRequest.url ?? entry.prUrl,
      githubAuthorLogin: pullRequest.authorLogin,
      githubAuthorUrl: pullRequest.authorUrl,
    };
  }

  return {
    ...snapshot,
    running: snapshot.running.map(enrichEntry),
    queue: snapshot.queue.map(enrichEntry),
    recent: snapshot.recent.map(enrichEntry),
    anomalies: snapshot.anomalies.map(enrichEntry),
  };
}

export function createPullRequestService({
  loadPullRequests,
  cacheTtlMs = 10 * 60_000,
  now = () => new Date(),
} = {}) {
  let cached;
  let refreshPromise;

  return async function getPullRequests() {
    const currentTime = now().getTime();
    if (cached && currentTime < cached.expiresAt) return cached.value;

    if (!refreshPromise) {
      refreshPromise = Promise.resolve()
        .then(loadPullRequests)
        .then((pullRequests) => {
          cached = {
            value: pullRequests,
            expiresAt: now().getTime() + cacheTtlMs,
          };
          return pullRequests;
        })
        .catch((error) => {
          if (cached) {
            cached.expiresAt = now().getTime() + Math.min(cacheTtlMs, 60_000);
            return cached.value;
          }
          throw error;
        })
        .finally(() => {
          refreshPromise = undefined;
        });
    }

    return refreshPromise;
  };
}

export const GITHUB_PULLS_API = DEFAULT_API;
