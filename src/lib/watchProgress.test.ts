import { describe, it, expect } from 'vitest';
import { isSeriesFinished, sortByLastWatched, continuarDe, proximoEpisodio } from './watchProgress';
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

describe('continuarDe — o Continuar abre onde parou (20/10/2026)', () => {
  const serie = (seasons: Season[], lastWatchedAt?: string): WatchItem => ({ ...item('series', seasons), lastWatchedAt });
  const semO = (n: number, fora: number) => range(n).filter(e => e !== fora);

  it('último assistido 93 → abre o 94, mesmo com o 40 sem ✓', () => {
    expect(continuarDe(serie([season(1, 120, semO(93, 40))]))).toEqual({ season: 1, episode: 94 });
  });
  it('Dois Homens e Meio: T4 com ✓ até o 15 e buraco no 11 → T4E16 (antes abria o E11)', () => {
    const it = serie([season(1, 24, range(24)), season(2, 24, range(24)), season(3, 24, range(24)),
      season(4, 24, semO(15, 11)), season(5, 19, [])]);
    expect(continuarDe(it)).toEqual({ season: 4, episode: 16 });
  });
  it('último da temporada assistido → 1º da próxima', () => {
    expect(continuarDe(serie([season(1, 10, range(10)), season(2, 8, [])]))).toEqual({ season: 2, episode: 1 });
  });
  it('episódio em andamento (sem ✓) neste aparelho → abre ele', () => {
    const it = serie([season(1, 20, range(5))], '2026-10-20T20:00:00Z');
    const agora = Date.parse('2026-10-20T20:10:00Z');
    expect(continuarDe(it, { season: 1, episode: 6, ts: agora })).toEqual({ season: 1, episode: 6 });
  });
  it('em andamento já com ✓ → o seguinte ao último assistido', () => {
    const it = serie([season(1, 20, range(6))], '2026-10-20T20:00:00Z');
    expect(continuarDe(it, { season: 1, episode: 6, ts: Date.parse('2026-10-20T20:10:00Z') })).toEqual({ season: 1, episode: 7 });
  });
  it('em andamento velho (outro aparelho andou depois) → vale o banco', () => {
    const it = serie([season(1, 120, range(93))], '2026-10-20T20:00:00Z');
    const ontem = Date.parse('2026-10-19T20:00:00Z');
    expect(continuarDe(it, { season: 1, episode: 40, ts: ontem })).toEqual({ season: 1, episode: 94 });
  });
  it('em andamento fora da ficha (temporada/ep que não existe) → ignora', () => {
    expect(continuarDe(serie([season(1, 10, range(3))]), { season: 9, episode: 1 })).toEqual({ season: 1, episode: 4 });
  });
  it('nada assistido → 1º episódio; série toda vista → 1º sem ✓, senão o começo', () => {
    expect(continuarDe(serie([season(1, 10, [])]))).toEqual({ season: 1, episode: 1 });
    expect(continuarDe(serie([season(1, 3, [1, 3]), season(2, 2, [1, 2])]))).toEqual({ season: 1, episode: 2 });
    expect(continuarDe(serie([season(1, 2, [1, 2])]))).toEqual({ season: 1, episode: 1 });
    expect(continuarDe(null)).toEqual({ season: 1, episode: 1 });
  });
});

describe('proximoEpisodio — o "próximo" do player vira a temporada (27/10/2026)', () => {
  const dhm = [season(1, 24, []), season(2, 24, []), season(3, 24, []), season(4, 24, []), season(5, 19, [])];

  it('no meio da temporada → o seguinte', () => {
    expect(proximoEpisodio(dhm, 4, 23)).toEqual({ season: 4, episode: 24 });
  });
  it('Dois Homens e Meio: fim do T4 E24 → T5 E1 (antes o player parava)', () => {
    expect(proximoEpisodio(dhm, 4, 24)).toEqual({ season: 5, episode: 1 });
  });
  it('fim da última temporada → null (série acabou)', () => {
    expect(proximoEpisodio(dhm, 5, 19)).toBeNull();
  });
  it('pula temporada sem episódio e não depende da ordem da ficha', () => {
    expect(proximoEpisodio([season(3, 0, []), season(1, 10, []), season(4, 8, []), season(2, 12, [])], 2, 12))
      .toEqual({ season: 4, episode: 1 });
  });
  it('temporada fora da ficha ou ficha vazia → null', () => {
    expect(proximoEpisodio(dhm, 9, 1)).toBeNull();
    expect(proximoEpisodio(undefined, 1, 1)).toBeNull();
  });
});
