import {
  createQueueService,
  fetchRecentBuilds,
} from "./circleci.js";
import {
  createPullRequestService,
  enrichQueueSnapshot,
  fetchRecentPullRequests,
} from "./github.js";
import { buildQueueSnapshot } from "./queue.js";

export function createLiveQueueService({
  loadBuilds = () => fetchRecentBuilds(),
  loadPullRequests = () => fetchRecentPullRequests(),
  cacheTtlMs,
  metadataCacheTtlMs,
  now,
  onMetadataError = (error) =>
    console.warn(`GitHub metadata unavailable: ${error.message}`),
} = {}) {
  const getPullRequests = createPullRequestService({
    loadPullRequests,
    cacheTtlMs: metadataCacheTtlMs,
    now,
  });

  return createQueueService({
    loadBuilds,
    cacheTtlMs,
    now,
    buildSnapshot: async (builds, options) => {
      const snapshot = buildQueueSnapshot(builds, options);
      try {
        return enrichQueueSnapshot(snapshot, await getPullRequests());
      } catch (error) {
        onMetadataError(error);
        return snapshot;
      }
    },
  });
}
