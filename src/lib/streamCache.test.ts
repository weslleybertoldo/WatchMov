// src/lib/streamCache.test.ts
import { describe, it, expect } from 'vitest';
import { linkExpiresAt, isExpiredUrl } from './streamCache';

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
