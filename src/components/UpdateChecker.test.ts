import { describe, it, expect } from "vitest";
import { isNewerVersion } from "./UpdateChecker";

describe("isNewerVersion", () => {
  it("detects minor bump", () => {
    expect(isNewerVersion("2.6", "2.5")).toBe(true);
  });
  it("detects patch bump", () => {
    expect(isNewerVersion("2.5.1", "2.5")).toBe(true);
  });
  it("returns false on equal", () => {
    expect(isNewerVersion("2.5", "2.5")).toBe(false);
  });
  // Renumeração (3.102 -> 3.2): quem manda é a DATA do release, senão o app fica
  // preso achando que está em dia só porque "3.2" é numericamente menor.
  it("accepts renumbered release when it is more recent", () => {
    expect(isNewerVersion("3.2", "3.102", "2026-08-09T01:00:00Z", "2026-08-08T20:00:00Z")).toBe(true);
  });
  it("refuses an older release even with a bigger number", () => {
    expect(isNewerVersion("3.102", "3.2", "2026-08-08T20:00:00Z", "2026-08-09T01:00:00Z")).toBe(false);
  });
  it("falls back to numbers without dates", () => {
    expect(isNewerVersion("3.3", "3.2")).toBe(true);
    expect(isNewerVersion("3.1", "3.2")).toBe(false);
  });
  it("ignores the v prefix and spaces", () => {
    expect(isNewerVersion(" v2.5 ", "2.5")).toBe(false);
  });
  it("returns false without a remote version", () => {
    expect(isNewerVersion("", "2.5")).toBe(false);
  });
});
