// Retry and concurrency helpers for the upstream CircleCI and GitHub requests.
//
// Why this exists: the dashboard used to fire eleven parallel fetches per
// refresh with no retry. Each fetch performs its own DNS lookup, the local
// resolver occasionally drops a UDP reply, glibc then waits its 5 second
// timeout before retrying, and two drops in a row exceed undici's 10 second
// connect timeout. One such stall rejected the whole refresh with
// "TypeError: fetch failed" and the page showed an error banner.

const TRANSIENT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isTransientFetchError(error) {
  if (!error || error.name === "AbortError") return false;
  if (error.name === "TimeoutError") return true;

  const code = error.cause?.code ?? error.code;
  if (code) return TRANSIENT_CODES.has(code);
  return error instanceof TypeError && error.message === "fetch failed";
}

function attemptSignal(signal, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([signal, timeout])
    : signal;
}

function abortReason(signal) {
  return (
    signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
  );
}

export async function fetchWithRetry(
  fetchImpl,
  url,
  init = {},
  {
    attempts = 3,
    retryDelayMs = 500,
    timeoutMs = 25_000,
    sleep = defaultSleep,
    retryableStatuses = RETRYABLE_STATUSES,
  } = {},
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (init.signal?.aborted) throw abortReason(init.signal);

    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: attemptSignal(init.signal, timeoutMs),
      });

      if (
        response.ok ||
        !retryableStatuses.has(response.status) ||
        attempt === attempts
      ) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
      await response.body?.cancel?.().catch?.(() => {});
    } catch (error) {
      if (
        init.signal?.aborted ||
        !isTransientFetchError(error) ||
        attempt === attempts
      ) {
        throw error;
      }
      lastError = error;
    }

    await sleep(retryDelayMs * attempt);
  }

  throw lastError;
}

export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  const workers = Math.max(1, Math.min(limit || items.length, items.length));
  let next = 0;
  let failed = false;

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (!failed && next < items.length) {
        const index = next;
        next += 1;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );

  return results;
}
