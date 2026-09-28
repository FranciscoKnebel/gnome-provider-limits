export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_DEADLINE_MS = 15_000;

export interface RetryDecision {
  delayMs: number | null;
}

export interface RetryOptions {
  attempt: number;
  statusCode: number | null;
  maxAttempts?: number;
  retryAfterSeconds?: number | null;
  elapsedMs?: number;
  deadlineMs?: number;
  baseDelayMs?: number;
}

export function isRetryableStatus(statusCode: number | null): boolean {
  return statusCode === null || statusCode === 429 || statusCode >= 500;
}

export function nextRetry(options: RetryOptions): RetryDecision {
  const maxAttempts = options.maxAttempts ?? RETRY_MAX_ATTEMPTS;
  const deadlineMs = options.deadlineMs ?? RETRY_DEADLINE_MS;
  const baseDelayMs = options.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const elapsedMs = options.elapsedMs ?? 0;
  const retryAfterSeconds = options.retryAfterSeconds ?? null;

  if (!isRetryableStatus(options.statusCode)) return { delayMs: null };
  if (options.attempt >= maxAttempts) return { delayMs: null };

  const remainingMs = deadlineMs - elapsedMs;
  if (remainingMs <= 0) return { delayMs: null };

  const backoffMs =
    retryAfterSeconds !== null && retryAfterSeconds >= 0
      ? retryAfterSeconds * 1000
      : baseDelayMs * 2 ** options.attempt;
  const jitterMs = Math.floor(Math.random() * Math.min(baseDelayMs, remainingMs));

  return { delayMs: Math.min(backoffMs + jitterMs, remainingMs) };
}
