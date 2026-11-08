import { describe, expect, it } from 'vitest';
import { cabecalhosDaReproducao, ehHls, loaderPeloApp } from './playerDesktop';

// Loader falso no lugar do XhrLoader do hls.js: guarda o que recebeu pra o teste responder por ele.
type Cbs = {
  onSuccess: (r: { url: string; data: unknown }, s: unknown, c: { url: string }, d: unknown) => void;
  onError: (e: unknown, c: { url: string }, d: unknown, s: unknown) => void;
  onTimeout: (s: unknown, c: { url: string }, d: unknown) => void;
};
class LoaderFalso {
  static ultimo: LoaderFalso | null = null;
  ctx: { url: string } = { url: '' };
  cbs: Cbs | null = null;
  constructor() { LoaderFalso.ultimo = this; }
  load(ctx: { url: string }, _cfg: unknown, cbs: Cbs) { this.ctx = ctx; this.cbs = cbs; }
}
const HlsFalso = { DefaultConfig: { loader: LoaderFalso } } as unknown as Parameters<typeof loaderPeloApp>[0];
const via = (u: string) => `wm-video://v/?t=k&u=${encodeURIComponent(u)}`;
const URL_REAL = 'https://embedplayer2.xyz/cdn/hls/abc/master.txt';

function carregar() {
  const Loader = loaderPeloApp(HlsFalso, via) as unknown as new (c: unknown) => { load: LoaderFalso['load'] };
  const visto: { sucesso?: { url: string }; erro?: string; tempo?: string; ctx?: string } = {};
  new Loader({}).load({ url: URL_REAL }, {}, {
    onSuccess: (r, _s, c) => { visto.sucesso = r; visto.ctx = c.url; },
    onError: (_e, c) => { visto.erro = c.url; },
    onTimeout: (_s, c) => { visto.tempo = c.url; },
  });
  const falso = LoaderFalso.ultimo as LoaderFalso;
  return { falso, visto };
}

describe('loaderPeloApp (hls.js busca pelo app)', () => {
  it('pede pelo endereço do app e devolve o endereço de verdade (pra resolver os caminhos da playlist)', () => {
    const { falso, visto } = carregar();
    expect(falso.ctx.url).toBe(via(URL_REAL));
    falso.cbs?.onSuccess({ url: via(URL_REAL), data: '#EXTM3U' }, {}, falso.ctx, null);
    expect(visto.sucesso?.url).toBe(URL_REAL);
    expect(visto.ctx).toBe(URL_REAL);
  });

  it('erro e tempo esgotado também saem com o endereço de verdade', () => {
    const a = carregar();
    a.falso.cbs?.onError({ code: 502 }, a.falso.ctx, null, {});
    expect(a.visto.erro).toBe(URL_REAL);
    const b = carregar();
    b.falso.cbs?.onTimeout({}, b.falso.ctx, null);
    expect(b.visto.tempo).toBe(URL_REAL);
  });
});

describe('ehHls', () => {
  it('playlist pelo endereço ou pelo tipo', () => {
    expect(ehHls('https://x.com/cdn/hls/a/master.txt')).toBe(true);
    expect(ehHls('https://x.com/a/playlist.m3u8?md5=1')).toBe(true);
    expect(ehHls('https://x.com/m3/abc', 'application/vnd.apple.mpegurl')).toBe(true);
    expect(ehHls('https://x.com/filme.mp4', 'video/mp4')).toBe(false);
  });
});

describe('cabecalhosDaReproducao', () => {
  it('sem Referer nos cabeçalhos, usa o referer da captura', () => {
    expect(cabecalhosDaReproducao({ headers: { 'User-Agent': 'UA' }, referer: 'https://s.com/v/1' }))
      .toEqual({ 'User-Agent': 'UA', Referer: 'https://s.com/v/1' });
    expect(cabecalhosDaReproducao({ headers: { referer: 'https://a.com/' }, referer: 'https://b.com/' }))
      .toEqual({ referer: 'https://a.com/' });
    expect(cabecalhosDaReproducao({})).toEqual({});
  });
});
