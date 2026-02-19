import { describe, it, expect, vi } from "vitest";
import { isTransientError, withTransientRetry } from "./transient-retry.js";

describe("isTransientError", () => {
  it("should return true for error with status 429", () => {
    const error = Object.assign(new Error("Rate limited"), { status: 429 });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with status 500", () => {
    const error = Object.assign(new Error("Internal server error"), { status: 500 });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with status 502", () => {
    const error = Object.assign(new Error("Bad gateway"), { status: 502 });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with status 503", () => {
    const error = Object.assign(new Error("Service unavailable"), { status: 503 });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with status 504", () => {
    const error = Object.assign(new Error("Gateway timeout"), { status: 504 });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return false for error with status 401", () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(isTransientError(error)).toBe(false);
  });

  it("should return false for error with status 403", () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(isTransientError(error)).toBe(false);
  });

  it("should return false for error with status 400", () => {
    const error = Object.assign(new Error("Bad request"), { status: 400 });
    expect(isTransientError(error)).toBe(false);
  });

  it("should return true for error with code ECONNREFUSED", () => {
    const error = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with code ETIMEDOUT", () => {
    const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with code ECONNRESET", () => {
    const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with code EPIPE", () => {
    const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for error with name containing ConnectionError", () => {
    const error = new Error("Connection refused");
    error.name = "APIConnectionError";
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for ECONNREFUSED in message (Google SDK fallback)", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
    expect(isTransientError(error)).toBe(true);
  });

  it("should return true for ETIMEDOUT in message", () => {
    const error = new Error("connect ETIMEDOUT 10.0.0.1:443");
    expect(isTransientError(error)).toBe(true);
  });

  it("should return false for generic Error without status or connection pattern", () => {
    expect(isTransientError(new Error("Something went wrong"))).toBe(false);
  });

  it("should return false for non-Error values", () => {
    expect(isTransientError("string error")).toBe(false);
    expect(isTransientError(42)).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it("should return true for plain object with transient status", () => {
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(true);
  });

  it("should return false for plain object with non-transient status", () => {
    expect(isTransientError({ status: 400 })).toBe(false);
  });

  it("should return true for connection error with status undefined (Google SDK pattern)", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { status: undefined });
    expect(isTransientError(error)).toBe(true);
  });
});

describe("withTransientRetry", () => {
  const noDelay = () => Promise.resolve();

  it("should return result on first attempt success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const delay = vi.fn(noDelay);

    const result = await withTransientRetry(fn, 2, 1000, delay);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("should retry on transient error and succeed on second attempt", async () => {
    const error503 = Object.assign(new Error("overloaded"), { status: 503 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error503)
      .mockResolvedValueOnce("recovered");
    const delay = vi.fn(noDelay);

    const result = await withTransientRetry(fn, 2, 1000, delay);

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("should retry twice and succeed on third attempt", async () => {
    const error429 = Object.assign(new Error("rate limited"), { status: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce("finally");
    const delay = vi.fn(noDelay);

    const result = await withTransientRetry(fn, 2, 1000, delay);

    expect(result).toBe("finally");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("should throw after exhausting all retries on transient errors", async () => {
    const error503 = Object.assign(new Error("overloaded"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(error503);
    const delay = vi.fn(noDelay);

    await expect(withTransientRetry(fn, 2, 1000, delay)).rejects.toThrow("overloaded");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("should throw immediately on non-transient error without retrying", async () => {
    const error401 = Object.assign(new Error("Unauthorized"), { status: 401 });
    const fn = vi.fn().mockRejectedValue(error401);
    const delay = vi.fn(noDelay);

    await expect(withTransientRetry(fn, 2, 1000, delay)).rejects.toThrow("Unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("should call delay with exponential backoff values", async () => {
    const error503 = Object.assign(new Error("overloaded"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(error503);
    const delay = vi.fn(noDelay);

    await expect(withTransientRetry(fn, 2, 1000, delay)).rejects.toThrow();
    expect(delay).toHaveBeenNthCalledWith(1, 1000); // 1000 * 2^0
    expect(delay).toHaveBeenNthCalledWith(2, 2000); // 1000 * 2^1
  });

  it("should not call delay after last failed attempt", async () => {
    const error503 = Object.assign(new Error("overloaded"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(error503);
    const delay = vi.fn(noDelay);

    await expect(withTransientRetry(fn, 2, 1000, delay)).rejects.toThrow();
    // 2 retries = 2 delays (before attempt 1 and before attempt 2, not after attempt 2)
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("should use custom maxRetries", async () => {
    const error503 = Object.assign(new Error("overloaded"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(error503);
    const delay = vi.fn(noDelay);

    await expect(withTransientRetry(fn, 1, 1000, delay)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("should use custom baseDelayMs", async () => {
    const error503 = Object.assign(new Error("overloaded"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(error503);
    const delay = vi.fn(noDelay);

    await expect(withTransientRetry(fn, 2, 500, delay)).rejects.toThrow();
    expect(delay).toHaveBeenNthCalledWith(1, 500);  // 500 * 2^0
    expect(delay).toHaveBeenNthCalledWith(2, 1000); // 500 * 2^1
  });
});
