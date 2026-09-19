import { describe, expect, it } from "vitest";
import { isAttemptExpired, TIME_LIMIT_GRACE_MS } from "@/lib/assessments/attempt";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("isAttemptExpired", () => {
  it("is not expired well within the limit", () => {
    expect(isAttemptExpired(minutesAgo(5), 30)).toBe(false);
  });

  it("is not expired right at the limit", () => {
    expect(isAttemptExpired(minutesAgo(30), 30)).toBe(false);
  });

  it("is not expired within the grace window past the limit (a client auto-submit still in flight)", () => {
    const graceMinutes = TIME_LIMIT_GRACE_MS / 60_000;
    expect(isAttemptExpired(minutesAgo(30 + graceMinutes - 0.1), 30)).toBe(false);
  });

  it("is expired once the limit plus grace has genuinely passed", () => {
    const graceMinutes = TIME_LIMIT_GRACE_MS / 60_000;
    expect(isAttemptExpired(minutesAgo(30 + graceMinutes + 1), 30)).toBe(true);
  });

  it("is expired for an attempt abandoned hours ago", () => {
    expect(isAttemptExpired(minutesAgo(600), 30)).toBe(true);
  });
});
