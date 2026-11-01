import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  chaveFavorito, chavesDosFavoritos, ehFavorito, fichaDaBiblioteca, pedirMenuFavorito, publicarFavoritos,
  registrarMenuFavorito, useEhFavorito,
} from './favorites';
import type { WatchItem } from '@/types/watch';
import type { MediaSummary, TmdbDetails } from '@/lib/tmdb';

const item = (over: Partial<WatchItem>): WatchItem => ({
  id: 'x', title: 'T', type: 'movie', createdAt: '2026-11-01', ...over,
} as WatchItem);

describe('chavesDosFavoritos', () => {
  it('só entram as fichas marcadas como favorito e com título da TMDB; série vira "tv"', () => {
    const s = chavesDosFavoritos([
      item({ id: '1', tmdbId: 39254, type: 'movie', favorite: true }),
      item({ id: '2', tmdbId: 1399, type: 'series', favorite: true }),
      item({ id: '3', tmdbId: 550, type: 'movie', favorite: false }),
      item({ id: '4', type: 'movie', favorite: true }),            // sem tmdbId (ficha antiga, manual)
    ]);
    expect([...s].sort()).toEqual(['movie-39254', 'tv-1399']);
  });
});

describe('publicarFavoritos / useEhFavorito', () => {
  beforeEach(() => { act(() => publicarFavoritos(new Set())); });

  it('a capa acende quando o título entra e apaga quando sai', () => {
    const { result } = renderHook(() => useEhFavorito('movie', 39254));
    expect(result.current).toBe(false);
    act(() => publicarFavoritos(new Set([chaveFavorito('movie', 39254)])));
    expect(result.current).toBe(true);
    expect(ehFavorito('movie', 39254)).toBe(true);
    act(() => publicarFavoritos(new Set()));
    expect(result.current).toBe(false);
  });

  it('filme e série com o mesmo número da TMDB não se confundem', () => {
    act(() => publicarFavoritos(new Set([chaveFavorito('tv', 100)])));
    expect(ehFavorito('tv', 100)).toBe(true);
    expect(ehFavorito('movie', 100)).toBe(false);
  });

  it('publicar as mesmas chaves de novo não redesenha a capa', () => {
    act(() => publicarFavoritos(new Set(['movie-1'])));
    let desenhos = 0;
    renderHook(() => { desenhos++; return useEhFavorito('movie', 1); });
    const antes = desenhos;
    act(() => publicarFavoritos(new Set(['movie-1'])));
    expect(desenhos).toBe(antes);
  });
});

describe('menu de segurar a capa', () => {
  it('sem ninguém registrado não abre nada; registrado, recebe a capa', () => {
    const m: MediaSummary = { tmdbId: 1, title: 'A', type: 'movie' };
    registrarMenuFavorito(null);
    expect(pedirMenuFavorito(m)).toBe(false);
    const abrir = vi.fn();
    registrarMenuFavorito(abrir);
    expect(pedirMenuFavorito(m)).toBe(true);
    expect(abrir).toHaveBeenCalledWith(m);
    registrarMenuFavorito(null);
  });
});

describe('fichaDaBiblioteca', () => {
  it('série: temporadas da TMDB zeradas, gênero e textos dos detalhes', () => {
    const det: TmdbDetails = {
      tmdbId: 1399, title: 'Game of Thrones', genre: 'Drama', imdbId: 'tt0944947', posterUrl: 'p.jpg',
      seasons: [{ number: 1, totalEpisodes: 10, episodeDuration: 55 }, { number: 2, totalEpisodes: 10, episodeDuration: 55 }],
    };
    const f = fichaDaBiblioteca({ tmdbId: 1399, title: 'GoT', type: 'tv', rating: 8.4 }, det);
    expect(f.type).toBe('series');
    expect(f.title).toBe('Game of Thrones');
    expect(f.genre).toBe('Drama');
    expect(f.rating).toBe(8.4);
    expect(f.seasons?.map(s => [s.number, s.totalEpisodes, s.watchedEpisodes, s.episodeDuration])).toEqual([[1, 10, 0, 55], [2, 10, 0, 55]]);
    expect(new Set(f.seasons?.map(s => s.id)).size).toBe(2);
  });

  it('filme sem detalhes (TMDB fora): sai com o básico do cartaz, sem temporadas', () => {
    const f = fichaDaBiblioteca({ tmdbId: 39254, title: 'Gigantes de Aço', type: 'movie', posterUrl: 'c.jpg', votes: 9000 }, null);
    expect(f).toMatchObject({ tmdbId: 39254, type: 'movie', title: 'Gigantes de Aço', posterUrl: 'c.jpg', votes: 9000 });
    expect(f.seasons).toBeUndefined();
    expect(f.genre).toBeUndefined();
  });
});
