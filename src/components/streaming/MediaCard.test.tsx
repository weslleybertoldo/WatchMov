import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import MediaCard from "./MediaCard";
import type { MediaSummary } from "@/lib/tmdb";
import { isTv } from "@/lib/device";
import { publicarFavoritos, registrarMenuFavorito } from "@/lib/favorites";
import { SEGURAR_TOQUE_MS } from "@/hooks/use-segurar";

vi.mock("@/lib/device", () => ({ isTv: vi.fn(() => false) }));

// A lista de cartazes já carregados é do módulo (vale a abertura inteira do app): cada teste usa um cartaz próprio.
const cartaz = (n: number): MediaSummary => ({
  type: "movie",
  tmdbId: n,
  title: `Cartaz ${n}`,
  posterUrl: `https://image.tmdb.org/t/p/w342/cartaz${n}.jpg`,
});

// "A tela pisca" no Fire TV (27/09/2026): a cada troca de tela todo cartaz voltava cinza até carregar de novo.
describe("MediaCard — cartaz que já carregou não pisca", () => {
  beforeEach(() => { vi.mocked(isTv).mockReturnValue(false); });

  it("1ª vez fica cinza, escondido, até a imagem carregar", () => {
    const { getByAltText } = render(<MediaCard media={cartaz(1)} onClick={() => {}} />);
    const img = getByAltText("Cartaz 1");
    expect(img).toHaveClass("opacity-0");
    expect(img.parentElement).toHaveClass("animate-pulse");
    fireEvent.load(img);
    expect(img).toHaveClass("opacity-100");
    expect(img.parentElement).not.toHaveClass("animate-pulse");
  });

  it("voltando pra tela, o cartaz que já carregou aparece direto, sem cinza", () => {
    const antes = render(<MediaCard media={cartaz(2)} onClick={() => {}} />);
    fireEvent.load(antes.getByAltText("Cartaz 2"));
    antes.unmount();
    const { getByAltText } = render(<MediaCard media={cartaz(2)} onClick={() => {}} />);
    const img = getByAltText("Cartaz 2");
    expect(img).toHaveClass("opacity-100");
    expect(img.parentElement).not.toHaveClass("animate-pulse");
  });

  it("cartaz que ainda não carregou continua esperando, mesmo com outro já carregado", () => {
    const outro = render(<MediaCard media={cartaz(3)} onClick={() => {}} />);
    fireEvent.load(outro.getByAltText("Cartaz 3"));
    const { getByAltText } = render(<MediaCard media={cartaz(4)} onClick={() => {}} />);
    expect(getByAltText("Cartaz 4")).toHaveClass("opacity-0");
  });

  it("na TV aparece sem o efeito de 0,5 s; no celular o efeito continua", () => {
    const celular = render(<MediaCard media={cartaz(5)} onClick={() => {}} />);
    expect(celular.getByAltText("Cartaz 5")).toHaveClass("transition-opacity");
    vi.mocked(isTv).mockReturnValue(true);
    const tv = render(<MediaCard media={cartaz(6)} onClick={() => {}} />);
    expect(tv.getByAltText("Cartaz 6")).not.toHaveClass("transition-opacity");
  });
});

// O jsdom 20 não tem PointerEvent: sem ele o React recebe o toque sem botão nem posição.
if (!("PointerEvent" in window)) {
  class PointerEventFake extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? "touch"; }
  }
  Object.assign(window, { PointerEvent: PointerEventFake });
}

// Favoritos (pedido dele 01/11/2026): pastinha na capa de quem é favorito; segurar a capa abre o menu de pôr/tirar.
describe("MediaCard — favoritos", () => {
  const abrirMenu = vi.fn();
  beforeEach(() => {
    vi.mocked(isTv).mockReturnValue(false);
    abrirMenu.mockClear();
    registrarMenuFavorito(abrirMenu);
    act(() => publicarFavoritos(new Set()));
  });
  afterEach(() => { registrarMenuFavorito(null); vi.useRealTimers(); });

  it("a pastinha aparece só na capa que é favorita, e some quando sai", () => {
    const fav = render(<MediaCard media={cartaz(20)} onClick={() => {}} />);
    const outro = render(<MediaCard media={cartaz(21)} onClick={() => {}} />);
    expect(fav.container.querySelector("[data-favorito]")).toBeNull();
    act(() => publicarFavoritos(new Set(["movie-20"])));
    expect(fav.container.querySelector("[data-favorito]")).not.toBeNull();
    expect(outro.container.querySelector("[data-favorito]")).toBeNull();
    act(() => publicarFavoritos(new Set()));
    expect(fav.container.querySelector("[data-favorito]")).toBeNull();
  });

  it("toque normal abre o título; segurar abre o menu e NÃO abre o título", () => {
    vi.useFakeTimers();
    const abrir = vi.fn();
    const { getByRole } = render(<MediaCard media={cartaz(22)} onClick={abrir} />);
    const capa = getByRole("button");
    fireEvent.pointerDown(capa, { button: 0, clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(120);
    fireEvent.pointerUp(capa, { button: 0 });
    fireEvent.click(capa);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrirMenu).not.toHaveBeenCalled();

    fireEvent.pointerDown(capa, { button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(SEGURAR_TOQUE_MS); });
    expect(abrirMenu).toHaveBeenCalledTimes(1);
    expect(abrirMenu.mock.calls[0][0]).toMatchObject({ tmdbId: 22, type: "movie" });
    fireEvent.pointerUp(capa, { button: 0 });
    fireEvent.click(capa);                         // o clique que vem depois de segurar
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it("arrastar (rolar a fileira) cancela o segurar", () => {
    vi.useFakeTimers();
    const { getByRole } = render(<MediaCard media={cartaz(23)} onClick={() => {}} />);
    const capa = getByRole("button");
    fireEvent.pointerDown(capa, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(capa, { clientX: 40, clientY: 12 });
    act(() => { vi.advanceTimersByTime(SEGURAR_TOQUE_MS * 2); });
    expect(abrirMenu).not.toHaveBeenCalled();
  });

  it("toque longo do Android (contextmenu) abre o menu uma vez só, sem o menu do sistema", () => {
    vi.useFakeTimers();
    const { getByRole } = render(<MediaCard media={cartaz(24)} onClick={() => {}} />);
    const capa = getByRole("button");
    fireEvent.pointerDown(capa, { button: 0, clientX: 10, clientY: 10 });
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { capa.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    act(() => { vi.advanceTimersByTime(SEGURAR_TOQUE_MS); });
    expect(abrirMenu).toHaveBeenCalledTimes(1);
  });

  it("TV: com várias capas na tela, o segurar abre o menu da capa que recebeu o aviso (um ouvinte só pra página)", () => {
    const { getAllByRole } = render(<div>
      <MediaCard media={cartaz(26)} onClick={() => {}} />
      <MediaCard media={cartaz(27)} onClick={() => {}} />
    </div>);
    const [, segunda] = getAllByRole("button");
    act(() => { segunda.dispatchEvent(new CustomEvent("tv-segurar", { bubbles: true })); });
    expect(abrirMenu).toHaveBeenCalledTimes(1);
    expect(abrirMenu).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 27 }));
  });

  it("onOpen (o da fileira) recebe a ficha da capa no toque", () => {
    const abrir = vi.fn();
    const { getByRole } = render(<MediaCard media={cartaz(28)} onOpen={abrir} />);
    fireEvent.click(getByRole("button"));
    expect(abrir).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 28, title: "Cartaz 28" }));
  });

  it("TV: segurar o OK (aviso do tvNav) abre o menu da capa", () => {
    const { getByRole } = render(<MediaCard media={cartaz(25)} onClick={() => {}} />);
    const capa = getByRole("button");
    expect(capa).toHaveAttribute("data-tv-hold");
    act(() => { capa.dispatchEvent(new CustomEvent("tv-segurar", { bubbles: true })); });
    expect(abrirMenu).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 25 }));
  });
});
