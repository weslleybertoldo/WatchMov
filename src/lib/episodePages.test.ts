import { describe, it, expect, beforeEach } from 'vitest';
import {
  pageCount, pageOfEpisode, pageEpisodes, pageLabel, defaultPage,
  loadEpisodePage, saveEpisodePage, seasonDone, loadSeason, saveSeason,
} from './episodePages';

describe('episodePages — abas de 12 episódios', () => {
  it('conta as abas', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(12)).toBe(1);
    expect(pageCount(13)).toBe(2);
    expect(pageCount(25)).toBe(3);
    expect(pageCount(1100)).toBe(92);
  });

  it('acha a aba de um episódio', () => {
    expect(pageOfEpisode(1)).toBe(0);
    expect(pageOfEpisode(12)).toBe(0);
    expect(pageOfEpisode(13)).toBe(1);
    expect(pageOfEpisode(48)).toBe(3);
    expect(pageOfEpisode(49)).toBe(4);
  });

  it('lista os episódios da aba e o nome dela', () => {
    expect(pageEpisodes(0, 25)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(pageEpisodes(1, 25)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(pageEpisodes(2, 25)).toEqual([25]);
    expect(pageEpisodes(3, 25)).toEqual([]);
    expect(pageLabel(0, 25)).toBe('1-12');
    expect(pageLabel(1, 25)).toBe('13-24');
    expect(pageLabel(2, 25)).toBe('25');
    expect(pageLabel(5, 25)).toBe('');
  });

  it('aba padrão = a do primeiro episódio não assistido; tudo visto = primeira', () => {
    expect(defaultPage(25, [])).toBe(0);
    expect(defaultPage(25, Array.from({ length: 12 }, (_, i) => i + 1))).toBe(1);
    expect(defaultPage(25, Array.from({ length: 24 }, (_, i) => i + 1))).toBe(2);
    expect(defaultPage(25, Array.from({ length: 25 }, (_, i) => i + 1))).toBe(0);
    // buraco no meio: volta pro primeiro que falta
    expect(defaultPage(25, [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toBe(0);
  });

  describe('aba lembrada por título+temporada', () => {
    beforeEach(() => localStorage.clear());
    it('sem registro devolve null', () => {
      expect(loadEpisodePage(127532, 1)).toBeNull();
    });
    it('grava e lê por título+temporada, sem misturar', () => {
      saveEpisodePage(127532, 1, 3);
      saveEpisodePage(127532, 2, 0);
      expect(loadEpisodePage(127532, 1)).toBe(3);
      expect(loadEpisodePage(127532, 2)).toBe(0);
      expect(loadEpisodePage(95479, 1)).toBeNull();
    });
    it('ignora lixo no storage', () => {
      localStorage.setItem('watchmov_ep_page', '{nope');
      expect(loadEpisodePage(1, 1)).toBeNull();
      saveEpisodePage(1, 1, 2);
      expect(loadEpisodePage(1, 1)).toBe(2);
    });
  });
});

describe('seasonDone — temporada 100% assistida', () => {
  it('todos os eps marcados = concluída; faltando um (ou fora de ordem) não', () => {
    expect(seasonDone(12, Array.from({ length: 12 }, (_, i) => i + 1))).toBe(true);
    expect(seasonDone(12, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(true);
    expect(seasonDone(12, Array.from({ length: 11 }, (_, i) => i + 1))).toBe(false);
    expect(seasonDone(12, [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toBe(false);
  });
  it('sem episódios nunca é concluída; extras além do total não atrapalham', () => {
    expect(seasonDone(0, [])).toBe(false);
    expect(seasonDone(3, [1, 2, 3, 4, 5])).toBe(true);
  });
});

describe('temporada lembrada por título', () => {
  beforeEach(() => localStorage.clear());
  it('sem registro devolve null', () => {
    expect(loadSeason(127532)).toBeNull();
  });
  it('grava e lê por título, sem misturar', () => {
    saveSeason(127532, 2);
    saveSeason(95479, 4);
    expect(loadSeason(127532)).toBe(2);
    expect(loadSeason(95479)).toBe(4);
    expect(loadSeason(1)).toBeNull();
  });
  it('ignora lixo no storage', () => {
    localStorage.setItem('watchmov_season', '{nope');
    expect(loadSeason(1)).toBeNull();
    saveSeason(1, 3);
    expect(loadSeason(1)).toBe(3);
  });
});
