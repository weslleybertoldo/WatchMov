import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeCode, formatCode, tvLinkFor, codeFromUrl, createTvCode, pollTvCode, approveTvCode,
  registerTvDevice, listTvDevices,
  capturePendingTvCode, takePendingTvCode,
} from "./tvPair";

function resp(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("código da TV", () => {
  it("aceita o que o celular digita (minúscula, traço, espaço)", () => {
    expect(normalizeCode("abc-def")).toBe("ABCDEF");
    expect(normalizeCode(" K7M 2QX ")).toBe("K7M2QX");
  });
  it("recusa tamanho errado e letras que confundem na TV (O, 0, I, 1)", () => {
    expect(normalizeCode("ABCDE")).toBeNull();
    expect(normalizeCode("ABCDEFG")).toBeNull();
    expect(normalizeCode("ABCDE0")).toBeNull();
    expect(normalizeCode("ABCDEI")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
  it("mostra em duas partes e monta o link do QR", () => {
    expect(formatCode("ABCDEF")).toBe("ABC-DEF");
    expect(tvLinkFor("ABCDEF")).toBe("https://watchmovbr.vercel.app/tv?c=ABCDEF");
  });
  it("lê o código do link do QR e ignora outros endereços", () => {
    expect(codeFromUrl("https://watchmovbr.vercel.app/tv?c=abcdef")).toBe("ABCDEF");
    expect(codeFromUrl("https://watchmov-staging.vercel.app/tv/?c=ABCDEF")).toBe("ABCDEF");
    expect(codeFromUrl("https://watchmovbr.vercel.app/?c=ABCDEF")).toBeNull();
    expect(codeFromUrl("com.weslley.watchmov://login-callback#access_token=x")).toBeNull();
    expect(codeFromUrl("https://watchmovbr.vercel.app/tv?c=12")).toBeNull();
    expect(codeFromUrl("não é url")).toBeNull();
  });
});

describe("chamadas da edge tv-pair", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("create devolve código, segredo e validade", async () => {
    fetchMock.mockReturnValue(resp(200, { code: "ABCDEF", secret: "s3", expires_at: "2026-09-26T04:00:00Z" }));
    await expect(createTvCode()).resolves.toEqual({ code: "ABCDEF", secret: "s3", expires_at: "2026-09-26T04:00:00Z" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "create" });
  });

  it("create com erro do servidor falha (a TV tenta de novo)", async () => {
    fetchMock.mockReturnValue(resp(500, { error: { code: "internal", message: "Erro interno" } }));
    await expect(createTvCode()).rejects.toThrow("Erro interno");
  });

  it("poll: esperando, aprovado (com token), vencido, usado, não achado", async () => {
    fetchMock.mockReturnValueOnce(resp(200, { status: "pending" }));
    await expect(pollTvCode("ABCDEF", "s")).resolves.toEqual({ status: "pending" });
    fetchMock.mockReturnValueOnce(resp(200, { status: "approved", token_hash: "th" }));
    await expect(pollTvCode("ABCDEF", "s")).resolves.toEqual({ status: "approved", token_hash: "th" });
    fetchMock.mockReturnValueOnce(resp(410, { error: { code: "expired" } }));
    await expect(pollTvCode("ABCDEF", "s")).resolves.toEqual({ status: "expired" });
    fetchMock.mockReturnValueOnce(resp(410, { error: { code: "used" } }));
    await expect(pollTvCode("ABCDEF", "s")).resolves.toEqual({ status: "used" });
    fetchMock.mockReturnValueOnce(resp(404, { error: { code: "not_found" } }));
    await expect(pollTvCode("ABCDEF", "s")).resolves.toEqual({ status: "not_found" });
  });

  it("approve manda o JWT do celular e devolve a mensagem de erro da edge", async () => {
    fetchMock.mockReturnValueOnce(resp(200, { ok: true, email: "a@b.com" }));
    await expect(approveTvCode("ABCDEF", "jwt-do-celular")).resolves.toEqual({ ok: true, email: "a@b.com" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt-do-celular");
    fetchMock.mockReturnValueOnce(resp(410, { error: { code: "expired", message: "Código vencido: a TV mostra outro" } }));
    await expect(approveTvCode("ABCDEF", "jwt")).resolves.toEqual({ ok: false, message: "Código vencido: a TV mostra outro" });
  });
});

describe("TVs conectadas", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a TV se registra com o JWT dela, nome e modelo", async () => {
    fetchMock.mockReturnValueOnce(resp(200, { ok: true }));
    await registerTvDevice("jwt-da-tv", { name: "Fire TV", model: "AFTSSS" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer jwt-da-tv");
    expect(JSON.parse(init.body)).toEqual({ action: "register", name: "Fire TV", model: "AFTSSS" });
  });

  it("register recusado vira erro (o app tenta na próxima abertura)", async () => {
    fetchMock.mockReturnValueOnce(resp(401, { error: { code: "unauthorized", message: "Sem login" } }));
    await expect(registerTvDevice("jwt", { name: "TV", model: "" })).rejects.toThrow("Sem login");
  });

  it("o celular lista as TVs da conta", async () => {
    const tv = { session_id: "s1", name: "Fire TV", model: "AFTSSS", created_at: "2026-09-26T04:07:43Z", last_seen_at: "2026-09-26T04:10:00Z" };
    fetchMock.mockReturnValueOnce(resp(200, { devices: [tv] }));
    await expect(listTvDevices("jwt-do-celular")).resolves.toEqual([tv]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "devices" });
    fetchMock.mockReturnValueOnce(resp(200, {}));
    await expect(listTvDevices("jwt")).resolves.toEqual([]);
  });
});

describe("código guardado do site aberto pelo QR", () => {
  beforeEach(() => { sessionStorage.clear(); });

  it("guarda o código da página /tv?c= e entrega 1 vez", () => {
    capturePendingTvCode({ href: "https://watchmovbr.vercel.app/tv?c=abcdef" } as Location);
    expect(takePendingTvCode()).toBe("ABCDEF");
    expect(takePendingTvCode()).toBeNull();
  });

  it("outras páginas não guardam nada", () => {
    capturePendingTvCode({ href: "https://watchmovbr.vercel.app/" } as Location);
    expect(takePendingTvCode()).toBeNull();
  });
});
