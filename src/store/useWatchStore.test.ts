import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock sonner so reportDbError doesn't try to render toasts in jsdom.
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// Build a chainable supabase mock with controllable responses per table+op.
type Op = "select" | "insert" | "update" | "delete";
interface Resp { data?: unknown; error?: { message: string } | null }
const responses: Record<string, Resp> = {};
function key(table: string, op: Op) { return `${table}:${op}`; }
function setResp(table: string, op: Op, r: Resp) { responses[key(table, op)] = r; }

vi.mock("@/lib/supabase", () => {
  function makeChain(table: string, op: Op) {
    const chain = {
      eq: () => chain,
      order: () => Promise.resolve(responses[key(table, op)] ?? { data: [], error: null }),
      select: () => chain,
      single: () => Promise.resolve(responses[key(table, op)] ?? { data: null, error: null }),
      then: (resolve: (v: Resp) => void) => resolve(responses[key(table, op)] ?? { data: null, error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from(table: string) {
        return {
          select: () => makeChain(table, "select"),
          insert: () => ({ ...makeChain(table, "insert"), select: () => makeChain(table, "insert") }),
          update: () => makeChain(table, "update"),
          delete: () => makeChain(table, "delete"),
        };
      },
    },
  };
});

import { useWatchStore } from "./useWatchStore";

const USER = "user-1";

beforeEach(() => {
  for (const k in responses) delete responses[k];
});

describe("useWatchStore", () => {
  it("retorna loading=true até carregar", async () => {
    setResp("wm_sections", "select", { data: [], error: null });
    setResp("wm_items", "select", { data: [], error: null });
    setResp("wm_sections", "insert", { data: [], error: null });

    const { result } = renderHook(() => useWatchStore(USER));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("getStats agrega serie/filme corretamente", async () => {
    const items = [
      {
        id: "s1", user_id: USER, section_id: "sec", title: "Show", type: "series",
        total_duration: null, watched_duration: 0, completed: false,
        seasons: [
          { id: "t1", number: 1, totalEpisodes: 10, watchedEpisodes: 10, episodeDuration: 24 },
        ],
        comment: null, last_watched_at: null, created_at: "2025-01-01",
      },
      {
        id: "m1", user_id: USER, section_id: "sec", title: "Movie", type: "movie",
        total_duration: 120, watched_duration: 60, completed: false,
        seasons: null, comment: null, last_watched_at: null, created_at: "2025-01-01",
      },
    ];
    setResp("wm_sections", "select", { data: [{ id: "sec", user_id: USER, name: "S", icon: "📁", created_at: "2025-01-01" }], error: null });
    setResp("wm_items", "select", { data: items, error: null });

    const { result } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const stats = result.current.getStats();
    expect(stats.totalItems).toBe(2);
    expect(stats.totalSeries).toBe(1);
    expect(stats.totalMovies).toBe(1);
    expect(stats.totalEpisodesWatched).toBe(10);
    expect(stats.totalTimeWatched).toBe(10 * 24 + 60);
    expect(stats.completedItems).toBe(1); // serie 100%
    expect(stats.totalTimeRemaining).toBe(60); // 120-60
  });

  it("continueWatching: série 100% assistida SAI, série em andamento e filme parcial FICAM", async () => {
    const base = { user_id: USER, section_id: null, total_duration: null, watched_duration: 0, completed: false, comment: null, created_at: "2025-01-01", tmdb_id: 1, imdb_id: null, poster_url: null, synopsis: null, genre: null, favorite: false, rating: null, votes: null };
    const items = [
      { ...base, id: "done", title: "Solo Leveling", type: "series", tmdb_id: 127532, last_watched_at: "2026-09-06T00:00:00Z",
        seasons: [{ id: "t1", number: 1, totalEpisodes: 25, watchedEpisodes: 25, episodeDuration: 24, watchedList: Array.from({ length: 25 }, (_, i) => i + 1) }] },
      { ...base, id: "going", title: "Frieren", type: "series", tmdb_id: 209867, last_watched_at: "2026-09-05T00:00:00Z",
        seasons: [{ id: "t1", number: 1, totalEpisodes: 38, watchedEpisodes: 6, episodeDuration: 25, watchedList: [1, 2, 3, 4, 5, 6] }] },
      { ...base, id: "two", title: "Duas temporadas", type: "series", tmdb_id: 3, last_watched_at: "2026-09-04T00:00:00Z",
        seasons: [
          { id: "a", number: 1, totalEpisodes: 12, watchedEpisodes: 12, episodeDuration: 24, watchedList: Array.from({ length: 12 }, (_, i) => i + 1) },
          { id: "b", number: 2, totalEpisodes: 13, watchedEpisodes: 0, episodeDuration: 24, watchedList: [] },
        ] },
      { ...base, id: "movie", title: "Filme", type: "movie", tmdb_id: 4, total_duration: 120, watched_duration: 30, last_watched_at: "2026-09-03T00:00:00Z", seasons: null },
      { ...base, id: "movie-done", title: "Filme visto", type: "movie", tmdb_id: 5, total_duration: 120, watched_duration: 120, completed: true, last_watched_at: "2026-09-02T00:00:00Z", seasons: null },
    ];
    setResp("wm_sections", "select", { data: [{ id: "sec", user_id: USER, name: "S", icon: "📁", created_at: "2025-01-01" }], error: null });
    setResp("wm_items", "select", { data: items, error: null });

    const { result } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.continueWatching.map(i => i.id);
    expect(ids).toEqual(["going", "two", "movie"]);   // ordem = último assistido primeiro
    expect(ids).not.toContain("done");
    expect(ids).not.toContain("movie-done");
  });

  it("addSection atualiza o estado quando o insert tem sucesso", async () => {
    setResp("wm_sections", "select", { data: [{ id: "sec", user_id: USER, name: "S", icon: "📁", created_at: "2025-01-01" }], error: null });
    setResp("wm_items", "select", { data: [], error: null });
    setResp("wm_sections", "insert", { data: { id: "sec2", user_id: USER, name: "Nova", icon: "🎬", created_at: "2025-01-02" }, error: null });

    const { result } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.addSection("Nova", "🎬"); });
    expect(result.current.data.sections.find(s => s.id === "sec2")?.name).toBe("Nova");
  });

  it("deleteSection remove section e items dela do estado (FK cascade no DB)", async () => {
    const items = [
      { id: "i1", user_id: USER, section_id: "sec", title: "x", type: "movie", total_duration: 90, watched_duration: 0, completed: false, seasons: null, comment: null, last_watched_at: null, created_at: "2025-01-01" },
      { id: "i2", user_id: USER, section_id: "other", title: "y", type: "movie", total_duration: 90, watched_duration: 0, completed: false, seasons: null, comment: null, last_watched_at: null, created_at: "2025-01-01" },
    ];
    setResp("wm_sections", "select", { data: [
      { id: "sec", user_id: USER, name: "S", icon: "📁", created_at: "2025-01-01" },
      { id: "other", user_id: USER, name: "O", icon: "📁", created_at: "2025-01-01" },
    ], error: null });
    setResp("wm_items", "select", { data: items, error: null });
    setResp("wm_sections", "delete", { data: null, error: null });

    const { result } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.items.length).toBe(2);

    await act(async () => { await result.current.deleteSection("sec"); });
    expect(result.current.data.sections.find(s => s.id === "sec")).toBeUndefined();
    expect(result.current.data.items.find(i => i.id === "i1")).toBeUndefined();
    expect(result.current.data.items.find(i => i.id === "i2")).toBeDefined();
  });
});
