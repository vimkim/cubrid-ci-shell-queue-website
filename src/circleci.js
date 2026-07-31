const DEFAULT_API =
  "https://circleci.com/api/v1.1/project/github/CUBRID/cubrid";

export async function fetchRecentBuilds({
  fetchImpl = fetch,
  apiUrl = DEFAULT_API,
  pages = 3,
  pageSize = 100,
  includeRunning = true,
  signal,
} = {}) {
  const urls = Array.from({ length: pages }, (_, page) => {
    const url = new URL(apiUrl);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));
    return url;
  });

  if (includeRunning) {
    const runningUrl = new URL(apiUrl);
    runningUrl.searchParams.set("limit", String(pageSize));
    runningUrl.searchParams.set("filter", "running");
    urls.push(runningUrl);
  }

  const requests = urls.map((url) => {
    return fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "cubrid-ci-shell-queue/1.0",
      },
      signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `CircleCI returned ${response.status} ${response.statusText}`.trim(),
        );
      }

      const body = await response.json();
      if (!Array.isArray(body)) {
        throw new Error("CircleCI returned an unexpected response");
      }
      return body;
    });
  });

  const pagesOfBuilds = await Promise.all(requests);
  const buildsByNumber = new Map();

  for (const build of pagesOfBuilds.flat()) {
    if (Number.isFinite(build?.build_num)) {
      buildsByNumber.set(build.build_num, build);
    }
  }

  return [...buildsByNumber.values()].sort(
    (left, right) => right.build_num - left.build_num,
  );
}

export function createQueueService({
  loadBuilds,
  buildSnapshot,
  cacheTtlMs = 30_000,
  now = () => new Date(),
} = {}) {
  let cached;
  let refreshPromise;

  async function refresh() {
    if (!refreshPromise) {
      refreshPromise = Promise.resolve()
        .then(loadBuilds)
        .then((builds) => {
          const generatedAt = now();
          cached = {
            value: buildSnapshot(builds, { now: generatedAt }),
            expiresAt: generatedAt.getTime() + cacheTtlMs,
          };
          return cached.value;
        })
        .finally(() => {
          refreshPromise = undefined;
        });
    }

    return refreshPromise;
  }

  return async function getQueue({ force = false } = {}) {
    const currentTime = now().getTime();
    if (!force && cached && currentTime < cached.expiresAt) {
      return { ...cached.value, cache: "hit" };
    }

    try {
      const value = await refresh();
      return { ...value, cache: "miss" };
    } catch (error) {
      if (cached) {
        return {
          ...cached.value,
          cache: "stale",
          warning: `Live refresh failed: ${error.message}`,
        };
      }
      throw error;
    }
  };
}

export const CIRCLECI_PROJECT_API = DEFAULT_API;
