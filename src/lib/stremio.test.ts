import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeAddonUrl, buildStremioId, buildMagnet, buildStremioDeepLink,
  fetchStreams, type StremioStream,
} from './stremio';

describe('normalizeAddonUrl', () => {
  it('remove /manifest.json e barra final', () => {
    expect(normalizeAddonUrl('https://torrentio.strem.fun/manifest.json')).toBe('https://torrentio.strem.fun');
    expect(normalizeAddonUrl('https://torrentio.strem.fun/')).toBe('https://torrentio.strem.fun');
    expect(normalizeAddonUrl('  https://x.io/cfg/manifest.json  ')).toBe('https://x.io/cfg');
  });
});

describe('buildStremioId', () => {
  it('filme usa imdbId', () => {
    expect(buildStremioId({ type: 'movie', imdbId: 'tt0133093' })).toEqual({ type: 'movie', id: 'tt0133093' });
  });
  it('série monta imdb:season:episode', () => {
    expect(buildStremioId({ type: 'tv', imdbId: 'tt0944947', season: 2, episode: 5 }))
      .toEqual({ type: 'series', id: 'tt0944947:2:5' });
  });
  it('série sem season/episode usa 1:1', () => {
    expect(buildStremioId({ type: 'tv', imdbId: 'tt1' })).toEqual({ type: 'series', id: 'tt1:1:1' });
  });
  it('sem imdbId retorna null', () => {
    expect(buildStremioId({ type: 'movie' })).toBeNull();
  });
});

describe('buildMagnet', () => {
  it('monta magnet com infoHash e trackers', () => {
    const s = { infoHash: 'abc123', filename: 'Movie.mkv', label: 'X' } as StremioStream;
    const m = buildMagnet(s);
    expect(m).toContain('magnet:?xt=urn:btih:abc123');
    expect(m).toContain('dn=Movie.mkv');
    expect(m).toContain('&tr=');
  });
});

describe('buildStremioDeepLink', () => {
  it('aponta pro web.stremio.com detail', () => {
    expect(buildStremioDeepLink({ type: 'movie', imdbId: 'tt0133093' }))
      .toBe('https://web.stremio.com/#/detail/movie/tt0133093/tt0133093');
  });
  it('null sem imdbId', () => {
    expect(buildStremioDeepLink({ type: 'movie' })).toBeNull();
  });
});

describe('fetchStreams', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('erro quando sem imdbId', async () => {
    const r = await fetchStreams([{ name: 'X', url: 'https://x.io' }], { type: 'movie' });
    expect(r.streams).toEqual([]);
    expect(r.errors[0]).toMatch(/IMDB/i);
  });

  it('normaliza streams de torrent (infoHash) e extrai qualidade/tamanho/dub', async () => {
    const payload = {
      streams: [{
        name: 'Torrentio\n1080p',
        title: 'The.Matrix.1999.1080p.BluRay.Dublado\n👤 89 💾 2.34 GB',
        infoHash: 'deadbeef', fileIdx: 1,
        behaviorHints: { filename: 'matrix.mkv', notWebReady: true },
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const r = await fetchStreams([{ name: 'Torrentio', url: 'https://torrentio.strem.fun' }], { type: 'movie', imdbId: 'tt0133093' });
    expect(r.errors).toEqual([]);
    expect(r.streams).toHaveLength(1);
    const s = r.streams[0];
    expect(s.infoHash).toBe('deadbeef');
    expect(s.quality).toBe('1080P');
    expect(s.size).toBe('2.34 GB');
    expect(s.dubbed).toBe(true);
    expect(s.qualityRank).toBe(3);
    expect(s.notWebReady).toBe(true);
    expect(s.url).toBeUndefined();
  });

  it('ordena dublado e maior qualidade primeiro', async () => {
    const payload = {
      streams: [
        { name: 'X 720p', infoHash: 'a', title: '720p legendado' },
        { name: 'X 1080p Dublado', infoHash: 'b', title: '1080p Dublado' },
        { name: 'X 4k', infoHash: 'c', title: '2160p legendado' },
        { name: 'X 4k Dublado', infoHash: 'd', title: '2160p Dual Audio' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const r = await fetchStreams([{ name: 'T', url: 'https://t.io' }], { type: 'movie', imdbId: 'tt1' });
    // dublados primeiro (4k dublado, depois 1080 dublado), depois legendados (4k, 720)
    expect(r.streams.map(s => s.infoHash)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('preserva url HTTP (reproduzível) e descarta stream sem url nem infoHash', async () => {
    const payload = {
      streams: [
        { name: 'Debrid 720p', url: 'https://cdn.example/movie.mp4', title: '720p' },
        { name: 'lixo', title: 'sem nada' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const r = await fetchStreams([{ name: 'D', url: 'https://d.io' }], { type: 'movie', imdbId: 'tt1' });
    expect(r.streams).toHaveLength(1);
    expect(r.streams[0].url).toBe('https://cdn.example/movie.mp4');
    expect(r.streams[0].quality).toBe('720P');
  });

  it('isola erro por addon (um falha, outro responde)', async () => {
    const ok = { streams: [{ name: 'A', infoHash: 'h1' }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ok) });
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchStreams(
      [{ name: 'Falha', url: 'https://f.io' }, { name: 'Boa', url: 'https://b.io' }],
      { type: 'movie', imdbId: 'tt1' },
    );
    expect(r.streams).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Falha/);
  });
});
