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
  };
  const ch = {
    on(_t: string, f: { event: string }, cb: (m: { payload: unknown }) => void) { s.handlers[f.event] = cb; return ch; },
    subscribe(cb: (st: string) => void) { setTimeout(() => cb(s.status), 0); return ch; },
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
  rt.s.status = "SUBSCRIBED"; rt.s.handlers = {}; rt.s.sent = []; rt.s.onSend = null; rt.s.removed = 0;
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
