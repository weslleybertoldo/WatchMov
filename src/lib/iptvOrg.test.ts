// src/lib/iptvOrg.test.ts — 03/11/2026: canais do iptv-org na aba Ao Vivo (Brasil nas categorias + aba Mundo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseM3u, traduzirCategoria, limparNome, paisDoId, bandeira, mimeDoLink,
  fetchIptvBrasil, fetchIptvMundo, IPTV_BR_URL, IPTV_MUNDO_URL,
} from './iptvOrg';

// Trecho no formato real das listas do iptv-org (03/11/2026), com CRLF de propósito.
const LISTA = [
  '#EXTM3U x-tvg-url=""',
  '#EXTINF:-1 tvg-id="Band.br@SD" tvg-logo="https://i.imgur.com/band.png" group-title="General",Band (720p)',
  'http://170.84.165.204/BAND_HD/index.m3u8',
  '#EXTINF:-1 tvg-id="RecordTVRio.br@SD" tvg-logo="" group-title="Undefined",RecordTV Rio (720p) [Geo-blocked]',
  '#EXTVLCOPT:http-referrer=https://www.record.com/',
  '#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0)',
  'https://exemplo.com/record/rio.m3u8?token=a=b',
  '#EXTINF:-1 tvg-id="CanalX.us@HD" tvg-logo="https://x/logo.png" group-title="Movies;Series",Canal, "X" (1080p) [Not 24/7]',
  'https://exemplo.com/x/playlist',
  '#EXTINF:-1 tvg-id="Adulto.xx" group-title="XXX;Movies",Adulto',
  'https://exemplo.com/adulto.m3u8',
  '#EXTINF:-1 tvg-id="Rtmp.de" group-title="News",Só RTMP',
  'rtmp://exemplo.com/live',
  '#EXTINF:-1 tvg-id="Band2.br@SD" group-title="General",Band repetida',
  'http://170.84.165.204/BAND_HD/index.m3u8',
  '#EXTINF:-1 tvg-id="" group-title="",Sem nada',
  'https://exemplo.com/sem.mpd',
].join('\r\n');

describe('iptv-org: leitura da lista M3U', () => {
  it('lê nome limpo, logo, país, categorias em português e o link', () => {
    const [band] = parseM3u(LISTA);
    expect(band).toEqual({
      url: 'http://170.84.165.204/BAND_HD/index.m3u8',
      name: 'Band',
      logo: 'https://i.imgur.com/band.png',
      categories: ['Geral'],
      country: 'br',
    });
  });

  it('referer e user-agent do #EXTVLCOPT vão junto (o "=" do token não corta o link)', () => {
    const record = parseM3u(LISTA)[1];
    expect(record.name).toBe('RecordTV Rio');
    expect(record.categories).toEqual(['Outros']);
    expect(record.referer).toBe('https://www.record.com/');
    expect(record.ua).toBe('Mozilla/5.0 (Windows NT 10.0)');
    expect(record.url).toBe('https://exemplo.com/record/rio.m3u8?token=a=b');
  });

  it('vírgula e aspas no nome não quebram a leitura; várias categorias ficam todas', () => {
    const x = parseM3u(LISTA)[2];
    expect(x.name).toBe('Canal, "X"');
    expect(x.categories).toEqual(['Filmes', 'Séries']);
    expect(x.country).toBe('us');
    expect(x.referer).toBeUndefined();
  });

  it('fica de fora: adulto, rtmp e link repetido; sem categoria = Outros', () => {
    const lista = parseM3u(LISTA);
    expect(lista.map(c => c.name)).toEqual(['Band', 'RecordTV Rio', 'Canal, "X"', 'Sem nada']);
    expect(lista[3]).toMatchObject({ categories: ['Outros'], country: '', url: 'https://exemplo.com/sem.mpd' });
  });

  it('o #EXTVLCOPT de um canal não vaza pro próximo', () => {
    const lista = parseM3u(LISTA);
    expect(lista[2].ua).toBeUndefined();
    expect(lista[3].referer).toBeUndefined();
  });
});

describe('iptv-org: pedaços', () => {
  it('traduz as categorias com os nomes do SuperFlix', () => {
    expect(traduzirCategoria('Sports')).toBe('Esportes');
    expect(traduzirCategoria('Entertainment')).toBe('Variedades');
    expect(traduzirCategoria('Animation')).toBe('Desenhos');
    expect(traduzirCategoria('News')).toBe('Notícias');
    expect(traduzirCategoria('Undefined')).toBe('Outros');
    expect(traduzirCategoria('')).toBe('Outros');
    expect(traduzirCategoria('XXX')).toBeNull();
    expect(traduzirCategoria('Novidade')).toBe('Novidade');
  });

  it('limpa o nome sem perder o país entre parênteses', () => {
    expect(limparNome('ESPN (Brazil) (1080p)')).toBe('ESPN (Brazil)');
    expect(limparNome('SBT Kids (1080p) [Geo-blocked]')).toBe('SBT Kids');
    expect(limparNome('Canal 576i')).toBe('Canal 576i');
    expect(limparNome('[Not 24/7]')).toBe('[Not 24/7]');
  });

  it('país pelo tvg-id e bandeira (uk = gb)', () => {
    expect(paisDoId('RedeGlobo.br@SD')).toBe('br');
    expect(paisDoId('CNN.us')).toBe('us');
    expect(paisDoId('SemPais')).toBe('');
    expect(bandeira('br')).toBe('🇧🇷');
    expect(bandeira('uk')).toBe('🇬🇧');
    expect(bandeira('')).toBe('');
  });

  it('tipo do link pro player nativo', () => {
    expect(mimeDoLink('https://a/b/index.m3u8?t=1')).toBe('application/x-mpegURL');
    expect(mimeDoLink('https://a/live/playlist')).toBe('application/x-mpegURL');
    expect(mimeDoLink('https://a/manifest.mpd')).toBe('application/dash+xml');
    expect(mimeDoLink('https://a/v.mp4')).toBe('video/mp4');
    expect(mimeDoLink('http://a/stream.ts')).toBeUndefined();
  });
});

describe('iptv-org: download e cache', () => {
  const pedidos: string[] = [];
  const respostas: Record<string, string> = {};

  beforeEach(() => {
    pedidos.length = 0;
    localStorage.clear();
    respostas[IPTV_BR_URL] = LISTA;
    respostas[IPTV_MUNDO_URL] = [
      LISTA,
      '#EXTINF:-1 tvg-id="BBC.uk@HD" group-title="News",BBC News',
      'https://exemplo.com/bbc.m3u8',
      '#EXTINF:-1 tvg-id="Globo.br@SD" group-title="General",Globo fora da lista do Brasil',
      'https://exemplo.com/globo.m3u8',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      pedidos.push(url);
      const corpo = respostas[url];
      return corpo === undefined
        ? new Response('erro', { status: 503 })
        : new Response(corpo, { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('Brasil: baixa uma vez e usa o cache depois; force baixa de novo', async () => {
    expect((await fetchIptvBrasil()).length).toBe(4);
    expect((await fetchIptvBrasil()).length).toBe(4);
    expect(pedidos.filter(u => u === IPTV_BR_URL)).toHaveLength(1);
    await fetchIptvBrasil(true);
    expect(pedidos.filter(u => u === IPTV_BR_URL)).toHaveLength(2);
  });

  it('Brasil: erro do servidor vira erro (a aba mostra "Tentar de novo")', async () => {
    delete respostas[IPTV_BR_URL];
    await expect(fetchIptvBrasil(true)).rejects.toThrow('503');
  });

  it('Mundo: tira tudo que já está na lista do Brasil (mesmo canal de fora) e os canais .br; o resto fica', async () => {
    const lista = await fetchIptvMundo(true);
    expect(lista.map(c => c.name)).toEqual(['BBC News']);
    expect(lista[0]).toMatchObject({ country: 'uk', categories: ['Notícias'] });
  });
});
