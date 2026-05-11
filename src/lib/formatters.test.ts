import { describe, it, expect } from "vitest";
import { formatTime, formatDate, getSeriesProgress, getSeasonProgress } from "./formatters";

describe("formatTime", () => {
  it("returns 0min for zero or negative", () => {
    expect(formatTime(0)).toBe("0min");
    expect(formatTime(-5)).toBe("0min");
  });
  it("formats sub-hour as minutes", () => {
    expect(formatTime(45)).toBe("45min");
  });
  it("formats whole hours", () => {
    expect(formatTime(120)).toBe("2h");
  });
  it("formats hours + minutes", () => {
    expect(formatTime(125)).toBe("2h 5min");
  });
});

describe("formatDate", () => {
  it("returns invalid label for bad input", () => {
    expect(formatDate("not-a-date")).toBe("Data invalida");
  });
  it("formats iso to dd/MM/yyyy", () => {
    expect(formatDate("2026-05-11T12:00:00Z")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("getSeasonProgress", () => {
  it("returns 0 when total is 0", () => {
    expect(getSeasonProgress({ watchedEpisodes: 0, totalEpisodes: 0 })).toBe(0);
  });
  it("returns percent", () => {
    expect(getSeasonProgress({ watchedEpisodes: 5, totalEpisodes: 10 })).toBe(50);
  });
});

describe("getSeriesProgress", () => {
  it("returns 0 with no seasons", () => {
    expect(getSeriesProgress([])).toBe(0);
  });
  it("sums across seasons", () => {
    expect(
      getSeriesProgress([
        { watchedEpisodes: 5, totalEpisodes: 10 },
        { watchedEpisodes: 10, totalEpisodes: 10 },
      ])
    ).toBe(75);
  });
});
