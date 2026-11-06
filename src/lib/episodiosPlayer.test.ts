import { describe, it, expect } from 'vitest';
import { montarSerie } from './episodiosPlayer';

const temporadas = [
  { number: 1, totalEpisodes: 62, episodeDuration: 24 },
  { number: 2, totalEpisodes: 74, episodeDuration: 0 },
  { number: 3, totalEpisodes: 12 },
];

describe('montarSerie (painel Episódios do player)', () => {
  it('manda por temporada o total, a duração, os assistidos e a barra de quem parou no meio', () => {
    const s = montarSerie({
      tmdbId: 46298, chave: 'k',
      temporadas,
      vistos: t => (t === 1 ? [1, 2, 3] : []),
      posicoes: {
        '1:4': { positionMs: 125_000, durationMs: 1_414_000 },   // parou em 02:05 de 23:34 → 9%
        '1:2': { positionMs: 700_000, durationMs: 1_400_000 },   // assistido: sem barra
        '2:7': { positionMs: 30_000 },                          // sem duração: sem barra
        '2:8': { positionMs: 1_500_000, durationMs: 1_400_000 }, // passou do fim: limita em 100
        '3:1': { positionMs: 1_000, durationMs: 1_400_000 },     // 0% arredondado: sem barra
      },
    });
    expect(s.tmdb).toBe(46298);
    expect(s.chave).toBe('k');
    expect(s.temporadas.map(t => t.n)).toEqual([1, 2, 3]);
    expect(s.temporadas[0]).toEqual({ n: 1, total: 62, min: 24, vistos: [1, 2, 3], pct: { 4: 9 } });
    expect(s.temporadas[1]).toEqual({ n: 2, total: 74, min: undefined, vistos: [], pct: { 8: 100 } });
    expect(s.temporadas[2].pct).toEqual({});
  });

  it('vai como JSON que o player lê (EpisodiosDados.serieDoApp)', () => {
    const json = JSON.stringify(montarSerie({ tmdbId: 2691, chave: 'k', temporadas: [{ number: 5, totalEpisodes: 19, episodeDuration: 22 }], vistos: () => [15], posicoes: {} }));
    expect(JSON.parse(json)).toEqual({ tmdb: 2691, chave: 'k', temporadas: [{ n: 5, total: 19, min: 22, vistos: [15], pct: {} }] });
  });
});
