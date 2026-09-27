import { describe, it, expect } from 'vitest';
import { isSeriesFinished, sortByLastWatched } from './watchProgress';
import type { WatchItem, Season } from '@/types/watch';

const season = (number: number, total: number, watched: number[] | number): Season => ({
  id: `s${number}`, number, totalEpisodes: total, episodeDuration: 24,
  ...(Array.isArray(watched)
    ? { watchedEpisodes: watched.length, watchedList: watched }
    : { watchedEpisodes: watched }),          // ficha antiga: só a contagem
});
const item = (type: 'movie' | 'series', seasons?: Season[]): WatchItem =>
  ({ id: 'i', title: 't', type, createdAt: '2026-01-01', seasons });
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('isSeriesFinished — série 100% assistida sai do Continuar assistindo', () => {
  it('todas as temporadas completas (watchedList) → terminada', () => {
    expect(isSeriesFinished(item('series', [season(1, 25, range(25))]))).toBe(true);
    expect(isSeriesFinished(item('series', [season(1, 12, range(12)), season(2, 13, range(13))]))).toBe(true);
  });
  it('ficha antiga só com a contagem → terminada quando a contagem bate', () => {
    expect(isSeriesFinished(item('series', [season(1, 10, 10)]))).toBe(true);
    expect(isSeriesFinished(item('series', [season(1, 10, 9)]))).toBe(false);
  });
  it('qualquer temporada incompleta → continua', () => {
    expect(isSeriesFinished(item('series', [season(1, 25, range(24))]))).toBe(false);
    expect(isSeriesFinished(item('series', [season(1, 12, range(12)), season(2, 13, [])]))).toBe(false);
  });
  it('episódio marcado fora da temporada não conta como progresso', () => {
    expect(isSeriesFinished(item('series', [season(1, 3, [1, 2, 7])]))).toBe(false);
    expect(isSeriesFinished(item('series', [season(1, 3, [1, 2, 3, 7])]))).toBe(true);
  });
  it('filme / sem temporadas / temporada sem episódios → nunca "terminada"', () => {
    expect(isSeriesFinished(item('movie'))).toBe(false);
    expect(isSeriesFinished(item('series', []))).toBe(false);
    expect(isSeriesFinished(item('series'))).toBe(false);
    expect(isSeriesFinished(item('series', [season(1, 0, [])]))).toBe(false);
  });
});

describe('sortByLastWatched — histórico começa pelo último assistido', () => {
  const visto = (id: string, createdAt: string, lastWatchedAt?: string): WatchItem =>
    ({ id, title: id, type: 'movie', completed: true, createdAt, lastWatchedAt });

  it('o assistido por último vem primeiro, não o que entrou primeiro no app', () => {
    const lista = [
      visto('michael', '2026-01-01', '2026-03-01'),
      visto('vingadores', '2026-01-02', '2026-09-20'),
      visto('ultimato', '2026-01-03', '2026-06-10'),
    ];
    expect(sortByLastWatched(lista).map(i => i.id)).toEqual(['vingadores', 'ultimato', 'michael']);
  });
  it('sem data de assistido usa a data em que entrou no app', () => {
    const lista = [
      visto('antigo', '2026-02-01'),
      visto('novo', '2026-01-01', '2026-05-01'),
      visto('velho', '2025-12-01'),
    ];
    expect(sortByLastWatched(lista).map(i => i.id)).toEqual(['novo', 'antigo', 'velho']);
  });
  it('não mexe na lista original', () => {
    const lista = [visto('a', '2026-01-01', '2026-01-02'), visto('b', '2026-01-01', '2026-01-03')];
    sortByLastWatched(lista);
    expect(lista.map(i => i.id)).toEqual(['a', 'b']);
  });
});
