import { describe, it, expect } from 'vitest';
import { mergeCaptured } from './capturedList';
import type { SniffResult } from './streamSniffer';

const master = (token: string, extra: Partial<SniffResult> = {}): SniffResult => ({
  url: `https://edge1-madrid-sprintcdn.r66nv9ed.com/hls2/02/11600/nd0f1xnmh0px_x/master.m3u8?t=${token}&s=1789411`,
  mime: 'application/vnd.apple.mpegurl',
  referer: 'https://f7hyg4q.org/',
  ...extra,
});

describe('mergeCaptured (dedup da lista "Links do vídeo")', () => {
  it('captura nova entra no fim da lista', () => {
    const a = master('aaa');
    const b: SniffResult = { url: 'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&id=abc', mime: 'video/mp4' };
    const out = mergeCaptured([a], b);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(b);
  });

  it('recaptura da mesma chave atualiza a URL e MANTÉM headers/quality/provider que a nova não trouxe', () => {
    const first = master('aaa', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; wv) Chrome/140.0.0.0 Mobile Safari/537.36', Origin: 'https://f7hyg4q.org' },
      quality: '1080p',
      provider: 'embedplayapi',
    });
    const again = master('bbb');                      // sniffer recapturou sem headers/quality
    const out = mergeCaptured([first], again);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain('t=bbb');
    expect(out[0].headers).toEqual(first.headers);
    expect(out[0].quality).toBe('1080p');
    expect(out[0].provider).toBe('embedplayapi');
    expect(out[0].referer).toBe('https://f7hyg4q.org/');
  });

  it('recaptura COM dados novos prevalece sobre os antigos', () => {
    const first = master('aaa', { quality: '720p', headers: { 'User-Agent': 'velho' } });
    const again = master('ccc', { quality: '1080p', headers: { 'User-Agent': 'novo' }, provider: 'superflix' });
    const out = mergeCaptured([first], again);
    expect(out[0].quality).toBe('1080p');
    expect(out[0].headers).toEqual({ 'User-Agent': 'novo' });
    expect(out[0].provider).toBe('superflix');
  });

  it('não mexe na lista original (imutável)', () => {
    const first = master('aaa', { quality: '480p' });
    const list = [first];
    const out = mergeCaptured(list, master('ddd'));
    expect(list[0]).toBe(first);
    expect(out).not.toBe(list);
  });
});
