import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizarProgresso, deveGravar, posicaoAtual, deveAdotar, adotarProgressoRemoto, posicoesComRemoto,
  GRAVAR_A_CADA_MS,
} from './progressoRemoto';
import { setStreamPosition, getEntry, posicaoLocal, addStreams } from './streamCache';
import { continuarDe, continueLabel, continueProgress } from './watchProgress';
import type { WatchItem, Season, ProgressoRemoto } from '@/types/watch';

const RE_ZERO = 65942;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const temporada = (vistos: number[]): Season => ({
  id: 's1', number: 1, totalEpisodes: 85, episodeDuration: 25, watchedEpisodes: vistos.length, watchedList: vistos,
});
const serie = (vistos: number[], progress?: ProgressoRemoto | null, lastWatchedAt?: string): WatchItem => ({
  id: 'item-rezero', title: 'Re:ZERO', type: 'series', createdAt: '2026-06-15', tmdbId: RE_ZERO,
  seasons: [temporada(vistos)], progress, lastWatchedAt,
});

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('normalizarProgresso — o que vem do banco', () => {
  it('ponto válido passa (dur opcional)', () => {
    expect(normalizarProgresso({ s: 1, e: 28, pos: 851000, dur: 1420000, ts: 1000 })).toEqual({ s: 1, e: 28, pos: 851000, dur: 1420000, ts: 1000 });
    expect(normalizarProgresso({ s: 0, e: 0, pos: 60000, ts: 5 })).toEqual({ s: 0, e: 0, pos: 60000, ts: 5 });
  });
  it('vazio, torto ou faltando campo = null', () => {
    expect(normalizarProgresso(null)).toBeNull();
    expect(normalizarProgresso('x')).toBeNull();
    expect(normalizarProgresso({ s: 1, e: 2, pos: 5000 })).toBeNull();          // sem ts
    expect(normalizarProgresso({ s: 1, e: 2, pos: -1, ts: 1 })).toBeNull();
    expect(normalizarProgresso({ s: 1, e: 2, pos: Number.NaN, ts: 1 })).toBeNull();
  });
  it('duração zero/negativa some', () => {
    expect(normalizarProgresso({ s: 1, e: 2, pos: 5000, dur: 0, ts: 1 })).toEqual({ s: 1, e: 2, pos: 5000, ts: 1 });
  });
});

describe('deveGravar — no máximo a cada 30 s por título', () => {
  const p = (e: number, pos: number) => ({ s: 1, e, pos });
  it('até 3 s não grava (abriu e fechou não apaga o ponto bom)', () => {
    expect(deveGravar(undefined, p(28, 2000), 0, true)).toBe(false);
  });
  it('1ª vez e troca de episódio gravam na hora', () => {
    expect(deveGravar(undefined, p(28, 10_000), 0, false)).toBe(true);
    expect(deveGravar({ s: 1, e: 28, pos: 900_000, em: 0 }, p(29, 5_000), 1000, false)).toBe(true);
  });
  it('tocando: espera 30 s; pausado (mesmo ponto) não grava', () => {
    const ult = { s: 1, e: 28, pos: 100_000, em: 0 };
    expect(deveGravar(ult, p(28, 110_000), GRAVAR_A_CADA_MS - 1, false)).toBe(false);
    expect(deveGravar(ult, p(28, 130_000), GRAVAR_A_CADA_MS, false)).toBe(true);
    expect(deveGravar(ult, p(28, 100_400), GRAVAR_A_CADA_MS * 3, false)).toBe(false);
  });
  it('player fechou (final) grava mesmo antes dos 30 s — se o ponto andou', () => {
    const ult = { s: 1, e: 28, pos: 100_000, em: 0 };
    expect(deveGravar(ult, p(28, 105_000), 1000, true)).toBe(true);
    expect(deveGravar(ult, p(28, 100_000), 1000, true)).toBe(false);
  });
});

describe('posicaoAtual — o ponto mais novo entre este aparelho e o banco', () => {
  it('nada em lugar nenhum = null', () => {
    expect(posicaoAtual(serie(range(27)))).toBeNull();
  });
  it('só o banco (este aparelho nunca tocou) → o do banco, com a hora em que tocou lá', () => {
    expect(posicaoAtual(serie(range(27), { s: 1, e: 28, pos: 851000, dur: 1420000, ts: 1000 })))
      .toEqual({ season: 1, episode: 28, positionMs: 851000, durationMs: 1420000, ts: 1000 });
  });
  it('este aparelho tocou DEPOIS → o daqui', () => {
    setStreamPosition(300_000, RE_ZERO, 'tv', 1, 29, 1_400_000);
    const p = posicaoAtual(serie(range(28), { s: 1, e: 28, pos: 851000, ts: 1000 }));
    expect(p).toMatchObject({ season: 1, episode: 29, positionMs: 300_000 });
  });
  it('o banco é mais novo (outro aparelho tocou depois) → o do banco', () => {
    setStreamPosition(300_000, RE_ZERO, 'tv', 1, 27);
    const p = posicaoAtual(serie(range(26), { s: 1, e: 28, pos: 851000, ts: Date.now() + 60_000 }));
    expect(p).toMatchObject({ season: 1, episode: 28, positionMs: 851000 });
  });
  it('link capturado depois NÃO conta como posição nova (posTs, não ts)', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    setStreamPosition(300_000, RE_ZERO, 'tv', 1, 28);                 // posição às 1_000_000
    vi.setSystemTime(5_000_000);
    addStreams([{ url: 'https://x/a.m3u8', mime: 'application/x-mpegURL' }], RE_ZERO, 'tv', 1, 28);   // só link, mais tarde
    const p = posicaoAtual(serie(range(27), { s: 1, e: 28, pos: 851000, ts: 3_000_000 }));
    expect(p).toMatchObject({ episode: 28, positionMs: 851000 });
  });
  it('ponto do banco com até 3 s é ignorado', () => {
    expect(posicaoAtual(serie(range(27), { s: 1, e: 28, pos: 2000, ts: 1000 }))).toBeNull();
  });
});

describe('deveAdotar — o ponto do banco vira a posição deste aparelho', () => {
  const r: ProgressoRemoto = { s: 1, e: 28, pos: 851000, ts: 5000 };
  it('outro episódio, já assistido ou ponto curto = não', () => {
    expect(deveAdotar(r, { s: 1, e: 29 }, null, false)).toBe(false);
    expect(deveAdotar(r, { s: 1, e: 28 }, null, true)).toBe(false);
    expect(deveAdotar({ ...r, pos: 1000 }, { s: 1, e: 28 }, null, false)).toBe(false);
    expect(deveAdotar(null, { s: 1, e: 28 }, null, false)).toBe(false);
  });
  it('este aparelho sem posição ou com posição mais velha = adota', () => {
    expect(deveAdotar(r, { s: 1, e: 28 }, null, false)).toBe(true);
    expect(deveAdotar(r, { s: 1, e: 28 }, { positionMs: 300_000, posTs: 4000 }, false)).toBe(true);
    expect(deveAdotar(r, { s: 1, e: 28 }, { positionMs: 0, posTs: 9999 }, false)).toBe(true);   // "do zero" não segura
  });
  it('este aparelho tocou depois = fica o daqui', () => {
    expect(deveAdotar(r, { s: 1, e: 28 }, { positionMs: 300_000, posTs: 5000 }, false)).toBe(false);
  });
});

describe('adotarProgressoRemoto — antes de abrir o episódio/filme', () => {
  it('grava a posição do banco aqui, mantém a entrada viva e limpa a do player do APK', () => {
    const limpar = vi.fn();
    const it = serie(range(27), { s: 1, e: 28, pos: 851000, dur: 1420000, ts: 1000 });
    expect(adotarProgressoRemoto(it, RE_ZERO, 'tv', 1, 28, false, limpar)).toBe(true);
    expect(limpar).toHaveBeenCalledWith(`${RE_ZERO}:tv:1:28`);
    expect(getEntry(RE_ZERO, 'tv', 1, 28)?.positionMs).toBe(851000);   // é daqui que sai o startMs do player
    expect(posicaoLocal(RE_ZERO, 'tv', 1, 28)).toEqual({ positionMs: 851000, durationMs: 1420000, posTs: 1000 });
    // De novo com o mesmo ponto: já é o daqui → não adota nem limpa outra vez.
    expect(adotarProgressoRemoto(it, RE_ZERO, 'tv', 1, 28, false, limpar)).toBe(false);
    expect(limpar).toHaveBeenCalledTimes(1);
  });
  it('filme usa a chave :movie:0:0', () => {
    const limpar = vi.fn();
    const filme: WatchItem = { id: 'f', title: 'Gigantes de Aço', type: 'movie', createdAt: 'x', tmdbId: 39254, progress: { s: 0, e: 0, pos: 1_894_806, ts: 10 } };
    expect(adotarProgressoRemoto(filme, 39254, 'movie', undefined, undefined, false, limpar)).toBe(true);
    expect(limpar).toHaveBeenCalledWith('39254:movie:0:0');
    expect(getEntry(39254, 'movie', 0, 0)?.positionMs).toBe(1_894_806);
  });
});

describe('posicoesComRemoto — barras do painel Episódios', () => {
  it('soma o ponto do banco quando é mais novo; o daqui ganha quando é mais novo', () => {
    setStreamPosition(120_000, RE_ZERO, 'tv', 1, 27);
    expect(posicoesComRemoto(serie(range(26), { s: 1, e: 28, pos: 851000, ts: 1 }), RE_ZERO))
      .toEqual({ '1:27': { positionMs: 120_000 }, '1:28': { positionMs: 851000 } });
    setStreamPosition(200_000, RE_ZERO, 'tv', 1, 28);
    expect(posicoesComRemoto(serie(range(26), { s: 1, e: 28, pos: 851000, ts: 1 }), RE_ZERO)['1:28'])
      .toEqual({ positionMs: 200_000 });
  });
});

describe('caso real (09/11/2026): E28 parou nos ~14 min na Fire TV e o projetor abriu do zero', () => {
  it('no projetor (sem nada guardado), o Continuar abre o E28 nos 14 min', () => {
    const fireTvParouEm = Date.parse('2026-11-08T06:12:00Z');                 // 03h12 de Brasília
    const ficha = serie(range(27), { s: 1, e: 28, pos: 851_000, dur: 1_420_000, ts: fireTvParouEm }, '2026-11-08T05:53:19Z');
    const c = continuarDe(ficha, posicaoAtual(ficha));
    expect(c).toEqual({ season: 1, episode: 28 });
    expect(adotarProgressoRemoto(ficha, RE_ZERO, 'tv', c.season, c.episode, false, () => {})).toBe(true);
    expect(getEntry(RE_ZERO, 'tv', 1, 28)?.positionMs).toBe(851_000);         // startMs do player
    expect(continueLabel(ficha)).toBe('EP 28/85 | Temporada 1');
    expect(continueProgress(ficha)?.label).toBe('14:11 / 23:40');
  });
  it('o E28 já assistido em outro aparelho → o Continuar vai pro E29 do começo', () => {
    const ficha = serie(range(28), { s: 1, e: 28, pos: 1_400_000, ts: Date.now() }, new Date().toISOString());
    const c = continuarDe(ficha, posicaoAtual(ficha));
    expect(c).toEqual({ season: 1, episode: 29 });
    expect(adotarProgressoRemoto(ficha, RE_ZERO, 'tv', c.season, c.episode, false, () => {})).toBe(false);
    expect(getEntry(RE_ZERO, 'tv', 1, 29)).toBeNull();
  });
});
