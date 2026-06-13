import { describe, it, expect } from "vitest";
import { formatTime, formatDate, getSeriesProgress, getSeasonProgress, formatVotes, formatRating } from "./formatters";

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

describe("formatVotes", () => {
  it("formats thousands as 'mil'", () => {
    expect(formatVotes(4000)).toBe("4 mil");
    expect(formatVotes(28000)).toBe("28 mil");
  });
  it("formats millions as 'mi' with comma", () => {
    expect(formatVotes(1_500_000)).toBe("1,5 mi");
  });
  it("keeps small numbers", () => {
    expect(formatVotes(750)).toBe("750");
  });
});

describe("formatRating", () => {
  it("returns null for missing/zero", () => {
    expect(formatRating(undefined, undefined)).toBeNull();
    expect(formatRating(0, 100)).toBeNull();
  });
  it("formats rating + votes", () => {
    expect(formatRating(8.247, 28000)).toBe("8.2/10 - 28 mil");
  });
  it("formats integer rating without decimal, no votes", () => {
    expect(formatRating(8, 0)).toBe("8/10");
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
