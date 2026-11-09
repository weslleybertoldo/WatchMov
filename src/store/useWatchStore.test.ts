import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock sonner so reportDbError doesn't try to render toasts in jsdom.
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// Build a chainable supabase mock with controllable responses per table+op.
type Op = "select" | "insert" | "update" | "delete";
interface Resp { data?: unknown; error?: { message: string } | null }
const responses: Record<string, Resp> = {};
// O que foi gravado (update) e quantas leituras (select) por tabela — minuto onde parou em todos os aparelhos.
const updates: Array<{ table: string; payload: unknown }> = [];
const selects: Record<string, number> = {};
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
          select: () => { selects[table] = (selects[table] ?? 0) + 1; return makeChain(table, "select"); },
          insert: () => ({ ...makeChain(table, "insert"), select: () => makeChain(table, "insert") }),
          update: (payload: unknown) => { updates.push({ table, payload }); return makeChain(table, "update"); },
          delete: () => makeChain(table, "delete"),
        };
      },
    },
  };
});

import { useWatchStore, RELER_DEPOIS_DE_MS, RELER_ESPERA_MS } from "./useWatchStore";
import { comecouEscrita, terminouEscrita, zerarEscritas } from "@/lib/escritasBanco";

const USER = "user-1";

beforeEach(() => {
  for (const k in responses) delete responses[k];
  updates.length = 0;
  for (const k in selects) delete selects[k];
  zerarEscritas();
  // Desde a W1 do raio-x o store nasce da biblioteca guardada no aparelho: sem limpar, o teste seguinte começava com
  // `loading=false` e a biblioteca do anterior, e a resposta do banco chegava DEPOIS (falhava às vezes: deleteSection e
  // o das listas memorizadas).
  localStorage.clear();
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

  // W2 do raio-x (02/11/2026): as fileiras do Início (memo) só redesenham quando a lista muda de verdade.
  it("continueWatching e myList são as mesmas listas entre desenhos enquanto a biblioteca não muda", async () => {
    const items = [
      { id: "c1", user_id: USER, section_id: "sec", title: "Em andamento", type: "movie", total_duration: 90, watched_duration: 30, completed: false, favorite: true, seasons: null, comment: null, last_watched_at: "2025-01-02T00:00:00Z", created_at: "2025-01-01" },
    ];
    setResp("wm_sections", "select", { data: [{ id: "sec", user_id: USER, name: "S", icon: "📁", created_at: "2025-01-01" }], error: null });
    setResp("wm_items", "select", { data: items, error: null });

    const { result, rerender } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { continueWatching, myList } = result.current;
    rerender();
    expect(result.current.continueWatching).toBe(continueWatching);
    expect(result.current.myList).toBe(myList);
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

  // ── Minuto onde parou em todos os aparelhos (09/11/2026) ──
  const fichaReZero = (progress: unknown) => ({
    id: "rz", user_id: USER, section_id: null, title: "Re:ZERO", type: "series", total_duration: null, watched_duration: 0,
    completed: false, comment: null, last_watched_at: "2026-11-08T05:53:19Z", created_at: "2026-06-15", tmdb_id: 65942,
    seasons: [{ id: "t1", number: 1, totalEpisodes: 85, watchedEpisodes: 27, episodeDuration: 25, watchedList: Array.from({ length: 27 }, (_, i) => i + 1) }],
    progress,
  });
  const comBiblioteca = (progress: unknown) => {
    setResp("wm_sections", "select", { data: [{ id: "sec", user_id: USER, name: "S", icon: "📁", created_at: "2025-01-01" }], error: null });
    setResp("wm_items", "select", { data: [fichaReZero(progress)], error: null });
  };
  const visibilidade = (v: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("lê o ponto do banco (progress) e descarta o torto", async () => {
    comBiblioteca({ s: 1, e: 28, pos: 851000, dur: 1420000, ts: 1762582320000 });
    const { result } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.items[0].progress).toEqual({ s: 1, e: 28, pos: 851000, dur: 1420000, ts: 1762582320000 });

    localStorage.clear();
    comBiblioteca({ s: "1" });
    const outro = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(outro.result.current.loading).toBe(false));
    expect(outro.result.current.data.items[0].progress).toBeNull();
  });

  it("salvarProgresso grava SÓ a coluna progress, no máximo a cada 30 s, e sempre ao fechar o player", async () => {
    comBiblioteca(null);
    const { result } = renderHook(() => useWatchStore(USER));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ponto = (pos: number) => ({ s: 1, e: 28, pos, ts: 1 });

    act(() => { result.current.salvarProgresso("rz", ponto(10_000)); });
    act(() => { result.current.salvarProgresso("rz", ponto(15_000)); });          // 5 s depois: espera
    expect(updates).toEqual([{ table: "wm_items", payload: { progress: ponto(10_000) } }]);
    act(() => { result.current.salvarProgresso("rz", ponto(20_000), true); });    // fechou o player: grava
    expect(updates.length).toBe(2);
    expect(updates[1].payload).toEqual({ progress: ponto(20_000) });
  });

  describe("relê a biblioteca ao voltar pra tela", () => {
    afterEach(() => {
      vi.useRealTimers();
      visibilidade("visible");
    });

    it("depois de 1 min fora → relê do banco (outro aparelho pode ter andado)", async () => {
      comBiblioteca(null);
      const { result } = renderHook(() => useWatchStore(USER));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(selects.wm_items).toBe(1);

      vi.useFakeTimers({ now: Date.now() });
      visibilidade("hidden");
      vi.advanceTimersByTime(RELER_DEPOIS_DE_MS + 1000);
      comBiblioteca({ s: 1, e: 28, pos: 851000, ts: 99 });                        // a Fire TV gravou enquanto isso
      visibilidade("visible");
      await act(async () => { await vi.advanceTimersByTimeAsync(RELER_ESPERA_MS + 10); });
      expect(selects.wm_items).toBe(2);
      expect(result.current.data.items[0].progress).toEqual({ s: 1, e: 28, pos: 851000, ts: 99 });
    });

    it("menos de 1 min fora → não relê", async () => {
      comBiblioteca(null);
      const { result } = renderHook(() => useWatchStore(USER));
      await waitFor(() => expect(result.current.loading).toBe(false));

      vi.useFakeTimers({ now: Date.now() });
      visibilidade("hidden");
      vi.advanceTimersByTime(10_000);
      visibilidade("visible");
      await act(async () => { await vi.advanceTimersByTimeAsync(RELER_ESPERA_MS * 3); });
      expect(selects.wm_items).toBe(1);
    });

    it("com gravação em andamento espera ela terminar (não traz a lista sem o ✓ que acabou de entrar)", async () => {
      comBiblioteca(null);
      const { result } = renderHook(() => useWatchStore(USER));
      await waitFor(() => expect(result.current.loading).toBe(false));

      vi.useFakeTimers({ now: Date.now() });
      visibilidade("hidden");
      vi.advanceTimersByTime(RELER_DEPOIS_DE_MS + 1000);
      comecouEscrita();                                                          // o ✓ do player fechando, ainda no ar
      visibilidade("visible");
      await act(async () => { await vi.advanceTimersByTimeAsync(RELER_ESPERA_MS + 10); });
      expect(selects.wm_items).toBe(1);
      terminouEscrita();
      await act(async () => { await vi.advanceTimersByTimeAsync(RELER_ESPERA_MS + 10); });
      expect(selects.wm_items).toBe(2);
    });
  });
});
