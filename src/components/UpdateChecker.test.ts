import { describe, it, expect } from "vitest";

// Re-implementing isNewerVersion here to test the comparison logic.
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number);
  const l = local.split(".").map(Number);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

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
