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
  it("returns false on older", () => {
    expect(isNewerVersion("2.4", "2.5")).toBe(false);
  });
  it("handles mismatched lengths", () => {
    expect(isNewerVersion("2.5.0", "2.5")).toBe(false);
    expect(isNewerVersion("2.5", "2.5.0")).toBe(false);
  });
});
