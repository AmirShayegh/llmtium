import { describe, it, expect, vi } from "vitest";
import { withStructuredRetry, RETRY_PROMPT } from "./structured-retry.js";

describe("withStructuredRetry", () => {
  it("should return parsed data on first attempt success", async () => {
    const attemptFn = vi.fn().mockResolvedValue('{"name":"test","value":42}');

    const result = await withStructuredRetry<{ name: string; value: number }>(attemptFn);

    expect(result).toEqual({ success: true, data: { name: "test", value: 42 } });
    expect(attemptFn).toHaveBeenCalledTimes(1);
    expect(attemptFn).toHaveBeenCalledWith(undefined);
  });

  it("should retry with repair prompt on first parse failure then succeed", async () => {
    const attemptFn = vi.fn()
      .mockResolvedValueOnce("not valid json {{{")
      .mockResolvedValueOnce('{"fixed":true}');

    const result = await withStructuredRetry<{ fixed: boolean }>(attemptFn);

    expect(result).toEqual({ success: true, data: { fixed: true } });
    expect(attemptFn).toHaveBeenCalledTimes(2);
    expect(attemptFn).toHaveBeenNthCalledWith(1, undefined);
    expect(attemptFn).toHaveBeenNthCalledWith(2, RETRY_PROMPT);
  });

  it("should return error after 3 consecutive parse failures", async () => {
    const attemptFn = vi.fn()
      .mockResolvedValueOnce("bad json 1")
      .mockResolvedValueOnce("bad json 2")
      .mockResolvedValueOnce("bad json 3");

    const result = await withStructuredRetry(attemptFn);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Structured output failed after 3 attempts");
    }
    expect(attemptFn).toHaveBeenCalledTimes(3);
  });

  it("should return error if attempt function throws", async () => {
    const attemptFn = vi.fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockRejectedValueOnce(new Error("network timeout"));

    const result = await withStructuredRetry(attemptFn);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("network timeout");
    }
  });

  it("should recover if first attempt throws but second succeeds", async () => {
    const attemptFn = vi.fn()
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce('{"recovered":true}');

    const result = await withStructuredRetry<{ recovered: boolean }>(attemptFn);

    expect(result).toEqual({ success: true, data: { recovered: true } });
    expect(attemptFn).toHaveBeenCalledTimes(2);
  });
});
