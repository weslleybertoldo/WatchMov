// src/lib/streamCache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { linkExpiresAt, isExpiredUrl, canRecaptureAgain, RECAPTURE_MIN_GAP_MS, applyTvPosition, getPosition, setStreamPosition } from './streamCache';

describe('streamCache — link novo pedido sozinho (venceu/caiu no meio)', () => {
  it('1º pedido sempre vale', () => {
    expect(canRecaptureAgain(0, 1_000)).toBe(true);
  });
  it('outro pedido em menos de 3 min = o link novo nem tocou → não', () => {
    const t = 1_790_000_000_000;
    expect(canRecaptureAgain(t, t + 60_000)).toBe(false);
    expect(canRecaptureAgain(t, t + RECAPTURE_MIN_GAP_MS - 1)).toBe(false);
  });
  it('3 min ou mais depois = o link novo tocou e venceu de novo (filme longo) → vale', () => {
    const t = 1_790_000_000_000;
    expect(canRecaptureAgain(t, t + RECAPTURE_MIN_GAP_MS)).toBe(true);
    expect(canRecaptureAgain(t, t + 12 * 60_000)).toBe(true);
  });
});

// Link real da Fonte 6 (A Hipótese do Amor, 24/09/2026): vence em ~10 min.
const F6 = 'https://vid7102402.hclod.qzz.io/st/_s3_/v14/1032863/playlist.m3u8?md5=WbC2m_gT-K5Jptmb_lu9TQ&expires=1790223765';

describe('streamCache — link com prazo (expires=)', () => {
  it('lê o prazo em segundos e devolve ms', () => {
    expect(linkExpiresAt(F6)).toBe(1790223765000);
    expect(linkExpiresAt('https://x.y/a.m3u8?exp=1790223765000&t=1')).toBe(1790223765000);   // já em ms
  });

  it('vencido quando passou do prazo (com 1 min de margem)', () => {
    const t = 1790223765000;
    expect(isExpiredUrl(F6, t + 1)).toBe(true);            // 12:47 tocou um link das 01:22
    expect(isExpiredUrl(F6, t - 30_000)).toBe(true);       // faltando 30 s: não abre (margem)
    expect(isExpiredUrl(F6, t - 5 * 60_000)).toBe(false);  // faltando 5 min: ainda vale
  });

  it('URL sem prazo, prazo sem cara de data ou link local nunca vencem', () => {
    expect(isExpiredUrl('https://embedplayer2.xyz/cdn/hls/abc/master.m3u8')).toBe(false);
    expect(isExpiredUrl('http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/1080p.mp4')).toBe(false);
    expect(linkExpiresAt('https://x.y/v.mp4?expires=123')).toBeNull();                 // curto demais
    expect(linkExpiresAt('https://x.y/v.mp4?X-Amz-Expires=604800')).toBeNull();        // duração, não data
    expect(linkExpiresAt('https://x.y/v.mp4?expires=9999999999')).toBeNull();          // ano 2286
    expect(isExpiredUrl(undefined)).toBe(false);
  });

  it('acha o prazo dentro da URL do proxy (u= codificada)', () => {
    const proxied = 'http://127.0.0.1:8099/s?u=' + encodeURIComponent(F6) + '&r=https%3A%2F%2Fv2.watchplay.shop%2F';
    expect(linkExpiresAt(proxied)).toBe(1790223765000);
  });
});

// 25/09/2026: TV tocando A Odisseia com o player fechado até 36:50 → a tela do título seguia em 28:52 (o tempo do
// fechar): com o player fechado ninguém escuta o progresso, e o tempo da TV vem da consulta do espelhamento.
describe('streamCache — tempo da TV com o player fechado', () => {
  const K = '1368337:movie:0:0';
  beforeEach(() => localStorage.clear());

  it('grava o tempo da TV no "continuar" do título', () => {
    setStreamPosition(1_732_000, 1368337, 'movie', 0, 0, 10_061_000);   // fechou o player em 28:52
    expect(applyTvPosition(K, 2_210_000, 10_061_000, Date.now() + 1000)).toBe(true);
    expect(getPosition(1368337, 'movie', 0, 0)).toEqual({ positionMs: 2_210_000, durationMs: 10_061_000 });
  });

  it('não volta pra trás o que o celular tocou depois (vale o mais novo)', () => {
    const antes = Date.now() - 60_000;
    setStreamPosition(3_000_000, 1368337, 'movie', 0, 0);                 // tocou no celular depois da TV
    expect(applyTvPosition(K, 2_210_000, undefined, antes)).toBe(false);
    expect(getPosition(1368337, 'movie', 0, 0)?.positionMs).toBe(3_000_000);
  });

  it('ignora o comecinho (até 3 s, igual ao player) e chave vazia', () => {
    expect(applyTvPosition(K, 2_000, undefined, Date.now())).toBe(false);
    expect(applyTvPosition('', 2_210_000, undefined, Date.now())).toBe(false);
    expect(getPosition(1368337, 'movie', 0, 0)).toBeNull();
  });
});
