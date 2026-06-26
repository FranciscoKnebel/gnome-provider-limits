/* eslint-disable no-unused-vars */
export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

export function assert(condition, message) {
  if (!condition) {
    throw new AssertionError(message || "assertion failed");
  }
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new AssertionError(
      message
        ? `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new AssertionError(
      message ? `${message}: expected ${e}, got ${a}` : `expected ${e}, got ${a}`,
    );
  }
}

export function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (_e) {
    threw = true;
  }
  if (!threw) {
    throw new AssertionError(message || "expected function to throw");
  }
}

export async function assertRejects(fn, message) {
  let threw = false;
  try {
    await fn();
  } catch (_e) {
    threw = true;
  }
  if (!threw) {
    throw new AssertionError(message || "expected function to reject");
  }
}

export function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new AssertionError(message || "expected non-null value");
  }
}
