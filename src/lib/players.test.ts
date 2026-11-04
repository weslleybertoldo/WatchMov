import { describe, expect, it } from 'vitest';
import { PROVIDERS, rotuloDaFonte } from './players';

describe('endereço das Fontes 5 e 6', () => {
  const build = (id: string) => PROVIDERS.find(p => p.id === id)!.build;

  // 04/11/2026: a vitrine da série (/serie/<id>) não abre servidor nenhum; com temporada e episódio a página da
  // WarezCDN já clica o episódio sozinha (CURRENT_EPISODE) e carrega a lista de servidores dele.
  it('Fonte 6 (WarezCDN): série vai direto no episódio; filme pelo TMDB', () => {
    expect(build('warezcdn')({ type: 'tv', tmdbId: 220102, season: 1, episode: 1 })).toBe('https://warezcdn.sbs/serie/220102/1/1');
    expect(build('warezcdn')({ type: 'tv', tmdbId: 2691, season: 5, episode: 15 })).toBe('https://warezcdn.sbs/serie/2691/5/15');
    expect(build('warezcdn')({ type: 'movie', tmdbId: 1368337 })).toBe('https://warezcdn.sbs/filme/1368337');
  });

  it('Fonte 5 (SuperFlix): IMDb primeiro, série com temporada e episódio', () => {
    expect(build('superflix')({ type: 'tv', tmdbId: 2691, imdbId: 'tt0369179', season: 5, episode: 15 })).toBe('https://superflixapi.fun/serie/tt0369179/5/15');
    expect(build('superflix')({ type: 'movie', tmdbId: 1368337, imdbId: 'tt33764258' })).toBe('https://superflixapi.fun/filme/tt33764258');
  });
});

describe('rotuloDaFonte', () => {
  it('número da fonte, etiqueta e o player escolhido', () => {
    expect(rotuloDaFonte('embedmovies', 'Blogger')).toBe('1 · EmbedMovies · Blogger');
    expect(rotuloDaFonte('superflix', '  Player   2 ')).toBe('5 · SuperFlix · Player 2');   // 19/10/2026: a Pomfy entrou como 4
    expect(rotuloDaFonte('megaembed', 'Opção 3')).toBe('7 · MegaEmbed · Opção 3');   // 20/10/2026: volta como 7
  });

  it('sem player escolhido fica só o servidor', () => {
    expect(rotuloDaFonte('embedmovies')).toBe('1 · EmbedMovies');
    expect(rotuloDaFonte('embedmovies', '')).toBe('1 · EmbedMovies');
  });

  it('servidor desconhecido não inventa nada', () => {
    expect(rotuloDaFonte('naoexiste', 'Blogger')).toBe('Blogger');
    expect(rotuloDaFonte(undefined, undefined)).toBe('');
  });
});
