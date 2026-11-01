import { describe, it, expect } from 'vitest';
import { ANIME_ROWS, ANIME_GENRES, recent, getCredits, ELENCO_MAX } from './tmdb';
import { isPrimaryGenre } from './rowFill';

const ACAO = 10759, FANTASIA = 10765, COMEDIA = 35, DRAMA = 18, MISTERIO = 9648, CRIME = 80, FAMILIA = 10751;
const ANIME_ROW_IDS = ANIME_GENRES.map(g => g.id);
// Em quais linhas da aba Animes o título (com estes gêneros, na ordem da TMDB) aparece.
const linhasDe = (genreIds: number[] | undefined) => ANIME_ROW_IDS.filter(id => isPrimaryGenre(genreIds, id, ANIME_ROW_IDS));

describe('aba Animes — linhas e regra "título só na categoria principal"', () => {
  it('sem as linhas mortas: "Animação" (gênero base) e "Romance" (gênero de filme, 0 em TV)', () => {
    const ids = ANIME_ROWS.map(r => r.id);
    expect(ids).not.toContain(16);
    expect(ids).not.toContain(10749);
    expect(ANIME_GENRES.map(g => g.id)).not.toContain(10749);
  });
  it('Procurar usa os mesmos gêneros das linhas (sem Populares)', () => {
    expect(ANIME_GENRES.map(g => g.id)).toEqual(ANIME_ROWS.filter(r => r.id != null).map(r => r.id));
  });
  // Gêneros na ordem que a TMDB devolveu em 20/10/2026.
  it('Naruto [Animação, Ação, Fantasia] fica só em Ação (antes também em Fantasia)', () => {
    expect(linhasDe([16, ACAO, FANTASIA])).toEqual([ACAO]);
  });
  it('Jujutsu Kaisen [Animação, Fantasia, Ação] fica só em Fantasia', () => {
    expect(linhasDe([16, FANTASIA, ACAO])).toEqual([FANTASIA]);
  });
  it('Ação com Comédia de sub-gênero fica só em Ação', () => {
    expect(linhasDe([16, ACAO, COMEDIA])).toEqual([ACAO]);
  });
  it('Detetive Conan [Animação, Crime, Mistério, Comédia] fica só em Crime', () => {
    expect(linhasDe([16, CRIME, MISTERIO, COMEDIA])).toEqual([CRIME]);
  });
  it('Diários de uma Apotecária [Animação, Drama, Mistério] fica só em Drama', () => {
    expect(linhasDe([16, DRAMA, MISTERIO])).toEqual([DRAMA]);
  });
  it('Doraemon [Ação, Animação, Comédia, Fantasia, Kids, Família] fica só em Ação', () => {
    expect(linhasDe([ACAO, 16, COMEDIA, FANTASIA, 10762, FAMILIA])).toEqual([ACAO]);
  });
  it('sem gênero de linha fica onde o discover devolveu', () => {
    expect(isPrimaryGenre([16], ACAO, ANIME_ROW_IDS)).toBe(true);
    expect(isPrimaryGenre(undefined, ACAO, ANIME_ROW_IDS)).toBe(true);
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

describe('getCredits() — elenco da página do título', () => {
  const comFetch = async (resposta: unknown, fn: (calls: string[]) => Promise<void>) => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return { ok: true, json: async () => resposta } as unknown as Response;
    }) as typeof fetch;
    try { await fn(calls); } finally { globalThis.fetch = orig; }
  };

  it('filme: /movie/{id}/credits, foto w185, personagem e no máximo 15', async () => {
    const cast = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `Ator ${i}`, character: i === 1 ? '  ' : `Papel ${i}`, profile_path: i === 2 ? null : `/f${i}.jpg` }));
    await comFetch({ cast }, async (calls) => {
      const r = await getCredits(39254, 'movie');
      expect(new URL(calls[0]).pathname).toContain('/movie/39254/credits');
      expect(r).toHaveLength(ELENCO_MAX);
      expect(r[0]).toEqual({ id: 0, name: 'Ator 0', character: 'Papel 0', profileUrl: 'https://image.tmdb.org/t/p/w185/f0.jpg' });
      expect(r[1].character).toBeUndefined();        // personagem em branco não vira linha vazia
      expect(r[2].profileUrl).toBeUndefined();       // sem foto: a fileira mostra as iniciais
    });
  });

  it('série: /tv/{id}/aggregate_credits e o papel com mais episódios', async () => {
    const cast = [{ id: 7, name: 'Bryan Cranston', profile_path: '/b.jpg', roles: [{ character: 'Ponta', episode_count: 1 }, { character: 'Walter White', episode_count: 62 }] }];
    await comFetch({ cast }, async (calls) => {
      const r = await getCredits(1396, 'tv');
      expect(new URL(calls[0]).pathname).toContain('/tv/1396/aggregate_credits');
      expect(r[0].character).toBe('Walter White');
    });
  });

  it('sem elenco na TMDB: lista vazia', async () => {
    await comFetch({}, async () => { expect(await getCredits(1, 'movie')).toEqual([]); });
  });
});
