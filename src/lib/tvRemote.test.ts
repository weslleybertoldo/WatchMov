import { describe, it, expect, vi, beforeEach } from "vitest";

// Canal do Realtime de mentira: guarda os ouvintes por evento e o que foi enviado; `onSend` faz o papel do
// outro aparelho (a TV respondendo, ou nada = desligada).
const rt = vi.hoisted(() => {
  const s = {
    status: "SUBSCRIBED",
    handlers: {} as Record<string, (m: { payload: unknown }) => void>,
    sent: [] as { event: string; payload: Record<string, unknown> }[],
    onSend: null as null | ((m: { event: string; payload: Record<string, unknown> }) => void),
    removed: 0,
    subCb: null as null | ((st: string) => void),
  };
  const ch = {
    on(_t: string, f: { event: string }, cb: (m: { payload: unknown }) => void) { s.handlers[f.event] = cb; return ch; },
    subscribe(cb: (st: string) => void) { s.subCb = cb; setTimeout(() => cb(s.status), 0); return ch; },
    async send(m: { event: string; payload: Record<string, unknown> }) { s.sent.push(m); s.onSend?.(m); return "ok"; },
  };
  return { s, ch };
});
vi.mock("@/lib/supabase", () => ({
  supabase: { channel: vi.fn(() => rt.ch), removeChannel: vi.fn(async () => { rt.s.removed++; return "ok"; }) },
}));

async function fresh() {
  vi.resetModules();
  return import("./tvRemote");
}
const media = { tmdbId: 1, title: "Lanternas", type: "tv" as const };
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

beforeEach(() => {
  rt.s.status = "SUBSCRIBED"; rt.s.handlers = {}; rt.s.sent = []; rt.s.onSend = null; rt.s.removed = 0; rt.s.subCb = null;
});

describe("qual TV é esta", () => {
  it("lê o session_id do JWT do Supabase", async () => {
    const { sessionIdOf } = await fresh();
    expect(sessionIdOf(`x.${b64url({ session_id: "abc-123", sub: "u1" })}.y`)).toBe("abc-123");
  });
  it("JWT quebrado ou sem sessão = null", async () => {
    const { sessionIdOf } = await fresh();
    expect(sessionIdOf("lixo")).toBeNull();
    expect(sessionIdOf(`x.${b64url({ sub: "u1" })}.y`)).toBeNull();
    expect(sessionIdOf(null)).toBeNull();
  });
  it("tópico do canal é da conta", async () => {
    const { topicFor } = await fresh();
    expect(topicFor("u1")).toBe("wm-tv:u1");
  });
});

describe("celular manda pra TV", () => {
  it("TV ligada responde → ok", async () => {
    const { sendToTv } = await fresh();
    rt.s.onSend = (m) => { if (m.event === "cmd") setTimeout(() => rt.s.handlers.ack({ payload: { id: m.payload.id } }), 5); };
    const r = await sendToTv("u1", { id: "c1", to: "tv-1", action: "open", media }, 500);
    expect(r).toBe("ok");
    expect(rt.s.sent[0]).toMatchObject({ event: "cmd", payload: { id: "c1", to: "tv-1", action: "open", media } });
  });
  it("resposta de OUTRO pedido não conta; sem resposta no prazo → no_answer (TV desligada)", async () => {
    const { sendToTv } = await fresh();
    rt.s.onSend = () => setTimeout(() => rt.s.handlers.ack({ payload: { id: "outro" } }), 5);
    expect(await sendToTv("u1", { id: "c2", to: "tv-1", action: "open", media }, 60)).toBe("no_answer");
  });
  it("canal recusado/sem rede → offline (não culpa a TV)", async () => {
    const { sendToTv } = await fresh();
    rt.s.status = "CHANNEL_ERROR";
    expect(await sendToTv("u1", { id: "c3", to: "tv-1", action: "open", media }, 60)).toBe("offline");
    expect(rt.s.sent).toHaveLength(0);
  });
  it("dois envios seguidos usam o mesmo canal (o realtime-js devolve o mesmo pro mesmo tópico)", async () => {
    const { sendToTv } = await fresh();
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.channel).mockClear();
    rt.s.onSend = (m) => setTimeout(() => rt.s.handlers.ack({ payload: { id: m.payload.id } }), 1);
    expect(await sendToTv("u1", { id: "a", to: "tv-1", action: "open", media }, 200)).toBe("ok");
    expect(await sendToTv("u1", { id: "b", to: "tv-1", action: "open", media }, 200)).toBe("ok");
    expect(vi.mocked(supabase.channel)).toHaveBeenCalledTimes(1);
    expect(rt.s.removed).toBe(0);
  });
});

describe("TV escuta", () => {
  const cmd = (id: string, to: string) => ({ payload: { id, to, action: "open", media } });
  const flush = () => new Promise((r) => setTimeout(r, 5));

  it("atende só o que é pra ELA e responde quando abriu", async () => {
    const { listenAsTv } = await fresh();
    const handle = vi.fn(async () => true);
    const stop = listenAsTv("u1", "tv-1", handle);
    rt.s.handlers.cmd(cmd("x1", "tv-2"));
    rt.s.handlers.cmd(cmd("x2", "tv-1"));
    await flush();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(rt.s.sent).toEqual([{ type: "broadcast", event: "ack", payload: { id: "x2" } }]);
    stop();
    expect(rt.s.removed).toBe(1);
  });
  it("app no fundo (handle = false) → não responde, e o celular dá TV desligada", async () => {
    const { listenAsTv } = await fresh();
    const stop = listenAsTv("u1", "tv-1", async () => false);
    rt.s.handlers.cmd(cmd("y1", "tv-1"));
    await flush();
    expect(rt.s.sent).toHaveLength(0);
    stop();
  });
  it("o mesmo pedido repetido abre uma vez só", async () => {
    const { listenAsTv } = await fresh();
    const handle = vi.fn(async () => true);
    const stop = listenAsTv("u1", "tv-1", handle);
    rt.s.handlers.cmd(cmd("z1", "tv-1"));
    rt.s.handlers.cmd(cmd("z1", "tv-1"));
    await flush();
    expect(handle).toHaveBeenCalledTimes(1);
    stop();
  });
});

// Controle remoto (pedido dele 07/11/2026): evento 'ctl' no mesmo canal; o ack traz o que está tocando.
describe("controle remoto", () => {
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const tocando = { title: "Re:ZERO", season: 1, episode: 2, positionMs: 492000, durationMs: 1420000, playing: true };

  it("celular: a tecla vai no evento ctl e a resposta traz o que a TV está tocando", async () => {
    const { mandarControle } = await fresh();
    rt.s.onSend = (m) => { if (m.event === "ctl") setTimeout(() => rt.s.handlers.ack({ payload: { id: m.payload.id, tocando } }), 1); };
    const r = await mandarControle("u1", { id: "k1", to: "tv-1", action: "key", key: "up" });
    expect(rt.s.sent[0]).toMatchObject({ event: "ctl", payload: { id: "k1", action: "key", key: "up" } });
    expect(r).toEqual({ result: "ok", tocando });
  });
  it("TV com o app antigo (não escuta ctl) não responde → no_answer, e não confunde com 'abrir título'", async () => {
    const { mandarControle } = await fresh();
    const r = await mandarControle("u1", { id: "k2", to: "tv-1", action: "ping" }, 30);
    expect(r).toEqual({ result: "no_answer" });
    expect(rt.s.sent.every((m) => m.event === "ctl")).toBe(true);
  });
  it("TV: atende o ctl dela e responde com o que está tocando; sem player, tocando null", async () => {
    const { listenAsTv } = await fresh();
    const handleCtl = vi.fn(async (c: { action: string }) => (c.action === "ping" ? { tocando: null } : { tocando }));
    const stop = listenAsTv("u1", "tv-1", async () => true, handleCtl);
    rt.s.handlers.ctl({ payload: { id: "c1", to: "tv-2", action: "ping" } });   // outra TV
    rt.s.handlers.ctl({ payload: { id: "c2", to: "tv-1", action: "ping" } });
    rt.s.handlers.ctl({ payload: { id: "c3", to: "tv-1", action: "key", key: "ok" } });
    rt.s.handlers.ctl({ payload: { id: "c3", to: "tv-1", action: "key", key: "ok" } });   // repetido
    await flush();
    expect(handleCtl).toHaveBeenCalledTimes(2);
    expect(rt.s.sent).toEqual([
      { type: "broadcast", event: "ack", payload: { id: "c2", tocando: null } },
      { type: "broadcast", event: "ack", payload: { id: "c3", tocando } },
    ]);
    stop();
  });
  it("TV com o WatchMov no fundo (handleCtl = false) não responde", async () => {
    const { listenAsTv } = await fresh();
    const stop = listenAsTv("u1", "tv-1", async () => true, async () => false);
    rt.s.handlers.ctl({ payload: { id: "c9", to: "tv-1", action: "ping" } });
    await flush();
    expect(rt.s.sent).toHaveLength(0);
    stop();
  });
});

describe("canal fechado e página congelada (achados no emulador, 07/11/2026)", () => {
  it("canal FECHADO pelo servidor → o próximo envio abre outro (antes ficava preso no fechado)", async () => {
    const { sendToTv } = await fresh();
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.channel).mockClear();
    rt.s.onSend = (m) => setTimeout(() => rt.s.handlers.ack({ payload: { id: m.payload.id } }), 1);
    expect(await sendToTv("u1", { id: "f1", to: "tv-1", action: "open", media }, 200)).toBe("ok");
    rt.s.subCb?.("CLOSED");
    expect(await sendToTv("u1", { id: "f2", to: "tv-1", action: "open", media }, 200)).toBe("ok");
    expect(vi.mocked(supabase.channel)).toHaveBeenCalledTimes(2);
  });
  it("TV: canal fechado volta sozinho na próxima tentativa (10 s)", async () => {
    vi.useFakeTimers();
    try {
      const { listenAsTv } = await fresh();
      const { supabase } = await import("@/lib/supabase");
      vi.mocked(supabase.channel).mockClear();
      const stop = listenAsTv("u1", "tv-1", async () => true);
      await vi.advanceTimersByTimeAsync(1);
      expect(vi.mocked(supabase.channel)).toHaveBeenCalledTimes(1);
      rt.s.subCb?.("CLOSED");
      await vi.advanceTimersByTimeAsync(10000);
      expect(vi.mocked(supabase.channel)).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it("pedidoVelho: só a página parada (batida atrasada) ou recém-descongelada", async () => {
    const { pedidoVelho } = await fresh();
    expect(pedidoVelho(10_000, 9_500, 0)).toBe(false);        // página viva
    expect(pedidoVelho(20_000, 9_500, 0)).toBe(true);         // batida parada há 10 s: chegou no descongelar
    expect(pedidoVelho(20_000, 19_800, 19_000)).toBe(true);   // a batida voltou agora: ainda é o lote preso
    expect(pedidoVelho(22_500, 22_000, 19_000)).toBe(false);  // passou o lote: tecla nova vale
  });
  it("TV: teclas presas enquanto a página estava congelada são ignoradas; as novas valem", async () => {
    vi.useFakeTimers();
    try {
      const { listenAsTv } = await fresh();
      const atendidos: string[] = [];
      const stop = listenAsTv("u1", "tv-1", async () => true, async (c) => { atendidos.push(c.id); return { tocando: null }; });
      await vi.advanceTimersByTimeAsync(1500);
      rt.s.handlers.ctl({ payload: { id: "vivo", to: "tv-1", action: "ping" } });
      vi.setSystemTime(Date.now() + 60_000);                   // congelou 1 min: o relógio andou, a batida não
      rt.s.handlers.ctl({ payload: { id: "preso", to: "tv-1", action: "key", key: "ok" } });
      await vi.advanceTimersByTimeAsync(1000);                  // a batida volta e marca o descongelar
      rt.s.handlers.ctl({ payload: { id: "lote", to: "tv-1", action: "key", key: "down" } });
      await vi.advanceTimersByTimeAsync(2500);
      rt.s.handlers.ctl({ payload: { id: "novo", to: "tv-1", action: "key", key: "up" } });
      await vi.advanceTimersByTimeAsync(10);
      expect(atendidos).toEqual(["vivo", "novo"]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resposta sem o que está tocando", () => {
  it("TV que não soube a tempo responde sem 'tocando' e o celular recebe undefined (mantém o último)", async () => {
    const { listenAsTv, mandarControle } = await fresh();
    const stop = listenAsTv("u1", "tv-1", async () => true, async () => ({ tocando: undefined }));
    rt.s.handlers.ctl({ payload: { id: "s1", to: "tv-1", action: "key", key: "next-ep" } });
    await new Promise(r => setTimeout(r, 5));
    const ack = rt.s.sent.find(m => m.event === "ack");
    expect(ack?.payload).toEqual({ id: "s1" });
    stop();
    rt.s.sent = [];
    rt.s.onSend = (m) => setTimeout(() => rt.s.handlers.ack({ payload: { id: m.payload.id } }), 1);
    expect(await mandarControle("u1", { id: "s2", to: "tv-1", action: "ping" }, 200)).toEqual({ result: "ok" });
  });
});
