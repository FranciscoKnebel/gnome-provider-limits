import {
  isRetryableStatus,
  nextRetry,
  RETRY_BASE_DELAY_MS,
  RETRY_DEADLINE_MS,
  RETRY_MAX_ATTEMPTS,
} from "../../src/helpers/retry.js";

describe("nextRetry defaults", () => {
  it("uses documented defaults", () => {
    expect(RETRY_MAX_ATTEMPTS).toBe(3);
    expect(RETRY_BASE_DELAY_MS).toBe(500);
    expect(RETRY_DEADLINE_MS).toBe(15_000);
  });
});

describe("isRetryableStatus", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableStatus(429)).toBeTrue();
    expect(isRetryableStatus(500)).toBeTrue();
    expect(isRetryableStatus(503)).toBeTrue();
  });

  it("retries network errors", () => {
    expect(isRetryableStatus(null)).toBeTrue();
  });

  it("does not retry other 4xx", () => {
    expect(isRetryableStatus(400)).toBeFalse();
    expect(isRetryableStatus(401)).toBeFalse();
    expect(isRetryableStatus(404)).toBeFalse();
  });

  it("does not retry 2xx", () => {
    expect(isRetryableStatus(200)).toBeFalse();
  });
});

describe("nextRetry", () => {
  it("honors Retry-After for 429", () => {
    const { delayMs } = nextRetry({
      attempt: 1,
      statusCode: 429,
      retryAfterSeconds: 2,
      elapsedMs: 0,
      deadlineMs: 15_000,
    });

    expect(delayMs).not.toBeNull();
    expect(delayMs as number).toBeGreaterThanOrEqual(2000);
    expect(delayMs as number).toBeLessThan(2500);
  });

  it("treats a zero Retry-After as no delay beyond jitter", () => {
    const { delayMs } = nextRetry({
      attempt: 1,
      statusCode: 429,
      retryAfterSeconds: 0,
      baseDelayMs: 0,
      elapsedMs: 0,
      deadlineMs: 15_000,
    });

    expect(delayMs).toBe(0);
  });

  it("grows exponentially on 5xx", () => {
    const first = nextRetry({ attempt: 1, statusCode: 500, elapsedMs: 0, deadlineMs: 15_000 });
    const second = nextRetry({ attempt: 2, statusCode: 500, elapsedMs: 0, deadlineMs: 15_000 });

    expect(first.delayMs as number).toBeGreaterThanOrEqual(1000);
    expect(first.delayMs as number).toBeLessThan(1500);
    expect(second.delayMs as number).toBeGreaterThanOrEqual(2000);
    expect(second.delayMs as number).toBeLessThan(2500);
  });

  it("retries network errors with backoff", () => {
    const { delayMs } = nextRetry({
      attempt: 1,
      statusCode: null,
      elapsedMs: 0,
      deadlineMs: 15_000,
    });

    expect(delayMs as number).toBeGreaterThanOrEqual(1000);
    expect(delayMs as number).toBeLessThan(1500);
  });

  it("does not retry 4xx other than 429", () => {
    expect(
      nextRetry({ attempt: 1, statusCode: 404, elapsedMs: 0, deadlineMs: 15_000 }).delayMs,
    ).toBeNull();
    expect(
      nextRetry({ attempt: 1, statusCode: 401, elapsedMs: 0, deadlineMs: 15_000 }).delayMs,
    ).toBeNull();
  });

  it("gives up once maxAttempts is reached", () => {
    expect(
      nextRetry({ attempt: 3, statusCode: 500, elapsedMs: 0, deadlineMs: 15_000 }).delayMs,
    ).toBeNull();
    expect(
      nextRetry({ attempt: 1, statusCode: 500, maxAttempts: 1, elapsedMs: 0, deadlineMs: 15_000 })
        .delayMs,
    ).toBeNull();
  });

  it("gives up when the deadline is exhausted", () => {
    expect(
      nextRetry({ attempt: 1, statusCode: 500, elapsedMs: 15_000, deadlineMs: 15_000 }).delayMs,
    ).toBeNull();
    expect(
      nextRetry({ attempt: 1, statusCode: 500, elapsedMs: 16_000, deadlineMs: 15_000 }).delayMs,
    ).toBeNull();
  });

  it("never delays past the remaining deadline", () => {
    const { delayMs } = nextRetry({
      attempt: 1,
      statusCode: 429,
      retryAfterSeconds: 60,
      elapsedMs: 14_600,
      deadlineMs: 15_000,
    });

    expect(delayMs).not.toBeNull();
    expect(delayMs as number).toBeLessThanOrEqual(400);
    expect(delayMs as number).toBeGreaterThanOrEqual(0);
  });

  it("keeps jitter bounded by the base delay", () => {
    for (let i = 0; i < 100; i++) {
      const { delayMs } = nextRetry({
        attempt: 2,
        statusCode: 500,
        elapsedMs: 0,
        deadlineMs: 15_000,
      });
      expect(delayMs as number).toBeGreaterThanOrEqual(2000);
      expect(delayMs as number).toBeLessThan(2500);
    }
  });
});
