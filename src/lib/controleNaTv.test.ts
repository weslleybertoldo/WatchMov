import { describe, it, expect, vi, beforeEach } from "vitest";
import { comPrazo, executarTecla, oQueToca, type AcoesDaTv } from "./controleNaTv";

// Controle remoto, lado da TV (pedido dele 07/11/2026).
function acoes(over: Partial<AcoesDaTv> = {}): AcoesDaTv {
  return {
    teclaNoPlayer: vi.fn(async () => false),
    estadoDoPlayer: vi.fn(async () => ({ open: false })),
    fecharPlayer: vi.fn(async () => false),
    voltar: vi.fn(),
    inicio: vi.fn(),
    ...over,
  };
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("executarTecla — com o player aberto", () => {
  it("a tecla vai pro player e a página não recebe nada", async () => {
    const a = acoes({ teclaNoPlayer: vi.fn(async () => true) });
    const ouvinte = vi.fn();
    window.addEventListener("keydown", ouvinte);
    await executarTecla("up", a);
    await executarTecla("ok-hold", a);
    await executarTecla("next-ep", a);
    window.removeEventListener("keydown", ouvinte);
    expect(a.teclaNoPlayer).toHaveBeenNthCalledWith(1, "up");
    expect(a.teclaNoPlayer).toHaveBeenNthCalledWith(2, "ok");   // segurar o OK no player = OK
    expect(a.teclaNoPlayer).toHaveBeenNthCalledWith(3, "next-ep");
    expect(ouvinte).not.toHaveBeenCalled();
  });
  it("Início fecha o player e vai pra aba Início", async () => {
    const a = acoes({ fecharPlayer: vi.fn(async () => true) });
    await executarTecla("home", a);
    expect(a.fecharPlayer).toHaveBeenCalled();
    expect(a.inicio).toHaveBeenCalled();
  });
});

describe("executarTecla — na página (sem player)", () => {
  it("seta vira a tecla do controle no item focado (o tvNav anda)", async () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const b = document.getElementById("b")!;
    b.focus();
    const teclas: string[] = [];
    window.addEventListener("keydown", (e) => teclas.push(e.key), { once: true });
    await executarTecla("down", acoes());
    expect(teclas).toEqual(["ArrowDown"]);
  });
  it("OK num botão clica (o navegador não clica com tecla de mentira)", async () => {
    document.body.innerHTML = `<button id="b">Assistir</button>`;
    const b = document.getElementById("b")!;
    const clique = vi.fn();
    b.addEventListener("click", clique);
    b.focus();
    await executarTecla("ok", acoes());
    expect(clique).toHaveBeenCalledTimes(1);
  });
  it("OK numa capa: aperta e solta o Enter (o tvNav abre no soltar); segurar = menu do título", async () => {
    document.body.innerHTML = `<button id="c" data-tv-hold>capa</button>`;
    const c = document.getElementById("c")!;
    c.focus();
    const visto: string[] = [];
    c.addEventListener("keydown", (e) => visto.push(`down:${e.key}`));
    c.addEventListener("keyup", (e) => visto.push(`up:${e.key}`));
    c.addEventListener("tv-segurar", () => visto.push("segurar"));
    await executarTecla("ok", acoes());
    await executarTecla("ok-hold", acoes());
    expect(visto).toEqual(["down:Enter", "up:Enter", "segurar"]);
  });
  it("Voltar usa o Voltar do app; ⏯ sem player não faz nada", async () => {
    const a = acoes();
    await executarTecla("back", a);
    await executarTecla("playpause", a);
    expect(a.voltar).toHaveBeenCalledTimes(1);
    expect(a.teclaNoPlayer).toHaveBeenCalledWith("playpause");
  });
});

describe("oQueToca", () => {
  it("player aberto: título, episódio, tempo e a capa do título aberto", async () => {
    const a = acoes({
      estadoDoPlayer: vi.fn(async () => ({ open: true, title: "Re:ZERO", season: 1, episode: 2, positionMs: 1000, durationMs: 2000, playing: true })),
      capa: () => "https://img/capa.jpg",
    });
    expect(await oQueToca(a)).toEqual({ title: "Re:ZERO", season: 1, episode: 2, positionMs: 1000, durationMs: 2000, playing: true, posterUrl: "https://img/capa.jpg" });
  });
  it("sem player: null", async () => {
    expect(await oQueToca(acoes())).toBeNull();
  });
  it("título do player 'Série — T5 E17' vira só a série (a faixa já mostra temporada e EP); filme fica igual", async () => {
    const serie = acoes({ estadoDoPlayer: vi.fn(async () => ({ open: true, title: "Dois Homens e Meio — T5 E17", season: 5, episode: 17 })) });
    expect((await oQueToca(serie))?.title).toBe("Dois Homens e Meio");
    const filme = acoes({ estadoDoPlayer: vi.fn(async () => ({ open: true, title: "A Odisseia — Parte 1" })) });
    expect((await oQueToca(filme))?.title).toBe("A Odisseia — Parte 1");
  });
});

describe("comPrazo — a TV responde a tempo mesmo com a tecla demorada", () => {
  it("terminou antes do prazo: o valor; demorou: undefined (e o trabalho segue); erro: undefined", async () => {
    expect(await comPrazo(Promise.resolve(7), 50)).toBe(7);
    let terminou = false;
    const lenta = new Promise<number>(r => setTimeout(() => { terminou = true; r(1); }, 80));
    expect(await comPrazo(lenta, 10)).toBeUndefined();
    await lenta;
    expect(terminou).toBe(true);
    expect(await comPrazo(Promise.reject(new Error("x")), 50)).toBeUndefined();
  });
});
