import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// Controle remoto no celular (pedido dele 07/11/2026): lista de TVs, tela vazia e o controle.
const m = vi.hoisted(() => ({
  mandar: vi.fn(),
  listar: vi.fn(),
  preparar: vi.fn(),
  guardarTv: vi.fn(),
  estadoWidget: vi.fn(),
  fixar: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "jwt", user: { id: "u1" } } } })) } },
}));
vi.mock("@/lib/tvPair", () => ({ listTvDevices: m.listar }));
vi.mock("@/lib/tvRemote", () => ({ mandarControle: m.mandar, newCmdId: () => `id-${Math.random()}` }));
vi.mock("@/lib/widgetControle", () => ({
  prepararWidget: m.preparar, guardarTvNoWidget: m.guardarTv, estadoDoWidget: m.estadoWidget, fixarWidget: m.fixar,
}));

import ControleRemotoView, { ULTIMA_TV } from "./ControleRemotoView";

const sala = { session_id: "tv-sala", name: "TV da sala", model: "Fire TV", created_at: "2026-11-01T00:00:00Z", last_seen_at: "2026-11-07T00:00:00Z" };
const projetor = { ...sala, session_id: "tv-proj", name: "Projetor", model: "TV Android" };
const tocando = { title: "Re:ZERO", season: 1, episode: 2, positionMs: 492000, durationMs: 1420000, playing: true };
const teclas = () => m.mandar.mock.calls.map((c) => c[1]).filter((c) => c.action === "key").map((c) => c.key);

beforeEach(() => {
  for (const f of [m.mandar, m.listar, m.preparar, m.guardarTv, m.estadoWidget, m.fixar]) f.mockReset();
  m.estadoWidget.mockResolvedValue(null);   // navegador: sem widget
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe("ControleRemotoView — escolher a TV", () => {
  it("lista as TVs com a bolinha de quem está com o WatchMov aberto e lembra a escolhida", async () => {
    m.listar.mockResolvedValue([sala, projetor]);
    m.mandar.mockImplementation(async (_u: string, c: { to: string }) => (c.to === "tv-sala" ? { result: "ok", tocando: null } : { result: "no_answer" }));
    const escolher = vi.fn();
    render(<ControleRemotoView tv={null} onEscolherTv={escolher} onBack={() => {}} onConectarTv={() => {}} />);
    expect(await screen.findByText("WatchMov aberto agora")).toBeTruthy();
    expect(await screen.findByText("Desligada ou com o WatchMov fechado")).toBeTruthy();
    fireEvent.click(screen.getByText("TV da sala"));
    expect(escolher).toHaveBeenCalledWith(sala);
    expect(JSON.parse(localStorage.getItem(ULTIMA_TV)!)).toEqual({ session_id: "tv-sala", name: "TV da sala" });
    // Widget da tela inicial: fica com a lista (e o token, com o login do app) e com a TV escolhida.
    expect(m.preparar).toHaveBeenCalledWith("jwt", [sala, projetor]);
    expect(m.guardarTv).toHaveBeenCalledWith(sala);
  });
  it("conta sem TV: tela vazia com Conectar uma TV", async () => {
    m.listar.mockResolvedValue([]);
    const conectar = vi.fn();
    render(<ControleRemotoView tv={null} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={conectar} />);
    fireEvent.click(await screen.findByRole("button", { name: /Conectar uma TV/ }));
    expect(conectar).toHaveBeenCalled();
  });
});

describe("ControleRemotoView — o controle", () => {
  it("conecta, mostra o que está tocando e manda as teclas", async () => {
    m.mandar.mockResolvedValue({ result: "ok", tocando });
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    expect(await screen.findByText("Conectada")).toBeTruthy();
    expect(screen.getByText("Tocando na TV")).toBeTruthy();
    expect(screen.getByText("Temporada 1 · EP 2 · 8:12 / 23:40")).toBeTruthy();
    for (const nome of ["Cima", "Voltar", "Início", "Play/pausa", "Ep. anterior", "Assistido", "Próximo ep."]) {
      fireEvent.click(screen.getAllByRole("button", { name: nome }).at(-1)!);
    }
    await waitFor(() => expect(teclas()).toEqual(["up", "back", "home", "playpause", "prev-ep", "watched", "next-ep"]));
  });
  it("OK: tocar manda ok; segurar manda só o ok-hold (menu do título)", async () => {
    m.mandar.mockResolvedValue({ result: "ok", tocando: null });
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    await screen.findByText("Conectada");
    vi.useFakeTimers();
    const ok = screen.getByRole("button", { name: "OK" });
    fireEvent.pointerDown(ok); fireEvent.pointerUp(ok);
    fireEvent.pointerDown(ok);
    act(() => { vi.advanceTimersByTime(700); });
    fireEvent.pointerUp(ok);
    vi.useRealTimers();
    await waitFor(() => expect(teclas()).toEqual(["ok", "ok-hold"]));
  });
  it("TV não respondeu: aviso + Tentar de novo; voltou, conecta de novo", async () => {
    m.mandar.mockResolvedValueOnce({ result: "no_answer" });
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    expect(await screen.findByText("A TV da sala não respondeu")).toBeTruthy();
    m.mandar.mockResolvedValue({ result: "ok", tocando: null });
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(await screen.findByText("Conectada")).toBeTruthy();
  });
  it("não respondeu e a TV voltou (trocou de episódio): o aviso some sozinho no próximo ping", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    m.mandar.mockResolvedValueOnce({ result: "no_answer" });
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    expect(await screen.findByText("A TV da sala não respondeu")).toBeTruthy();
    m.mandar.mockResolvedValue({ result: "ok", tocando });
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(await screen.findByText("Conectada")).toBeTruthy();
    expect(screen.queryByText("A TV da sala não respondeu")).toBeNull();
  });
  it("celular sem o widget na tela: botão Adicionar o controle à tela inicial", async () => {
    m.mandar.mockResolvedValue({ result: "ok", tocando: null });
    m.estadoWidget.mockResolvedValue({ temToken: true, tv: null, widgets: 0, suportaFixar: true });
    m.fixar.mockResolvedValue(true);
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar o controle à tela inicial/ }));
    expect(m.fixar).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Adicionar o controle à tela inicial/ })).toBeNull();
  });
  it("widget já na tela (ou launcher que não aceita): sem o botão", async () => {
    m.mandar.mockResolvedValue({ result: "ok", tocando: null });
    m.estadoWidget.mockResolvedValue({ temToken: true, tv: null, widgets: 1, suportaFixar: true });
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    await screen.findByText("Conectada");
    await waitFor(() => expect(m.estadoWidget).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Adicionar o controle à tela inicial/ })).toBeNull();
  });
  it("resposta sem 'tocando' (a TV não soube a tempo) mantém a faixa que já estava", async () => {
    m.mandar.mockResolvedValueOnce({ result: "ok", tocando });
    render(<ControleRemotoView tv={sala} onEscolherTv={() => {}} onBack={() => {}} onConectarTv={() => {}} />);
    expect(await screen.findByText("Tocando na TV")).toBeTruthy();
    m.mandar.mockResolvedValue({ result: "ok" });
    fireEvent.click(screen.getByRole("button", { name: "Avançar 10 s" }));
    await waitFor(() => expect(teclas()).toEqual(["ff"]));
    expect(screen.getByText("Tocando na TV")).toBeTruthy();
  });
});
