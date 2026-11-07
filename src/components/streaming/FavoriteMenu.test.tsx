import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FavoriteMenu from "./FavoriteMenu";
import type { MediaSummary } from "@/lib/tmdb";

// Remover da lista (pedido dele 07/11/2026): o 3º botão só aparece quando a capa segurada é do Continuar assistindo.
const reZero: MediaSummary = { tmdbId: 65942, title: "Re:ZERO", type: "tv" };

describe("FavoriteMenu — Remover da lista", () => {
  it("capa do Continuar: mostra o Remover da lista e ele recebe o título", () => {
    const remover = vi.fn();
    const fechar = vi.fn();
    render(<FavoriteMenu aberto alvo={{ media: reZero, favorito: true, continuar: true }}
      onAlternar={() => {}} onRemoverDaLista={remover} onFechar={fechar} />);
    expect(screen.getByRole("button", { name: /Remover dos favoritos/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Remover da lista/ }));
    expect(remover).toHaveBeenCalledWith(reZero);
  });

  it("capa de outra fileira: só Favoritos e Cancelar, como antes", () => {
    render(<FavoriteMenu aberto alvo={{ media: reZero, favorito: false }}
      onAlternar={() => {}} onRemoverDaLista={() => {}} onFechar={() => {}} />);
    expect(screen.getByRole("button", { name: /Adicionar aos favoritos/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remover da lista/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
