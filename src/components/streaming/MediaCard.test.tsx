import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import MediaCard from "./MediaCard";
import type { MediaSummary } from "@/lib/tmdb";
import { isTv } from "@/lib/device";

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
