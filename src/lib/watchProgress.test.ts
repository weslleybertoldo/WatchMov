import { describe, it, expect } from 'vitest';
import { isSeriesFinished } from './watchProgress';
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
