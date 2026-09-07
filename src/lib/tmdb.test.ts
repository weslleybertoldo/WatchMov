import { describe, it, expect } from 'vitest';
import { ANIME_ROWS, ANIME_GENRES, belongsToAnimeRow, recent } from './tmdb';

const ACAO = 10759, FANTASIA = 10765, COMEDIA = 35, DRAMA = 18, MISTERIO = 9648, CRIME = 80, FAMILIA = 10751;

describe('aba Animes — linhas e regra "título em até 2 linhas"', () => {
  it('sem as linhas mortas: "Animação" (gênero base) e "Romance" (gênero de filme, 0 em TV)', () => {
    const ids = ANIME_ROWS.map(r => r.id);
    expect(ids).not.toContain(16);
    expect(ids).not.toContain(10749);
    expect(ANIME_GENRES.map(g => g.id)).not.toContain(10749);
  });
  it('Procurar usa os mesmos gêneros das linhas (sem Populares)', () => {
    expect(ANIME_GENRES.map(g => g.id)).toEqual(ANIME_ROWS.filter(r => r.id != null).map(r => r.id));
  });
  it('Bleach (Ação+Fantasia) fica em Ação e Fantasia', () => {
    const g = [16, ACAO, FANTASIA];
    expect(belongsToAnimeRow(g, ACAO)).toBe(true);
    expect(belongsToAnimeRow(g, FANTASIA)).toBe(true);
  });
  it('Ação+Fantasia+Comédia: Comédia é a 3ª mais genérica → fica de fora', () => {
    const g = [16, ACAO, FANTASIA, COMEDIA];
    expect(belongsToAnimeRow(g, ACAO)).toBe(true);
    expect(belongsToAnimeRow(g, FANTASIA)).toBe(true);
    expect(belongsToAnimeRow(g, COMEDIA)).toBe(false);
  });
  it('Detetive Conan (Crime+Mistério+Comédia) fica em Crime e Mistério, não em Comédia', () => {
    const g = [16, CRIME, MISTERIO, COMEDIA];
    expect(belongsToAnimeRow(g, CRIME)).toBe(true);
    expect(belongsToAnimeRow(g, MISTERIO)).toBe(true);
    expect(belongsToAnimeRow(g, COMEDIA)).toBe(false);
  });
  it('Doraemon (Família+Ação+Comédia) fica em Família e Ação', () => {
    const g = [16, FAMILIA, ACAO, COMEDIA];
    expect(belongsToAnimeRow(g, FAMILIA)).toBe(true);
    expect(belongsToAnimeRow(g, ACAO)).toBe(true);
    expect(belongsToAnimeRow(g, COMEDIA)).toBe(false);
  });
  it('título só com Drama fica em Drama; sem gênero de linha fica onde o discover devolveu', () => {
    expect(belongsToAnimeRow([16, DRAMA], DRAMA)).toBe(true);
    expect(belongsToAnimeRow([16], ACAO)).toBe(true);
    expect(belongsToAnimeRow(undefined, ACAO)).toBe(true);
  });
});

describe('recent() — "Carregar mais" da aba Lançamentos', () => {
  it('manda a página pedida pro TMDB (antes ignorava e repetia a página 1)', async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return { ok: true, json: async () => ({ results: [] }) } as unknown as Response;
    }) as typeof fetch;
    try {
      await recent('movie');
      await recent('movie', 3);
      await recent('tv', 2);
      expect(new URL(calls[0]).searchParams.get('page')).toBe('1');
      expect(new URL(calls[0]).pathname).toContain('/movie/now_playing');
      expect(new URL(calls[1]).searchParams.get('page')).toBe('3');
      expect(new URL(calls[2]).searchParams.get('page')).toBe('2');
      expect(new URL(calls[2]).pathname).toContain('/tv/on_the_air');
    } finally { globalThis.fetch = orig; }
  });
});
