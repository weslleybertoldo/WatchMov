// src/lib/liveTv.test.ts — 03/11/2026: aba Ao Vivo = SuperFlix + iptv-org do Brasil nas mesmas categorias.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAoVivo, categoriesOf, filtrarCanais, doIptv, type Channel } from './liveTv';
import { IPTV_BR_URL } from './iptvOrg';

const SUPERFLIX = {
  data: [
    { id: 'espn', name: 'ESPN', logo_url: 'https://l/espn.png', embed_url: 'https://sf/canal/espn', category: 'Esportes' },
    { id: 'ae', name: 'A&E', logo_url: '', embed_url: 'https://sf/canal/ae', category: 'Variedades • Séries' },
    { id: 'off', name: 'Desligado', embed_url: 'https://sf/canal/off', category: 'Esportes', is_active: false },
  ],
};
const M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="SporTV2.br@SD" group-title="Sports",SporTV 2 (1080p)',
  'https://exemplo.com/sportv2.m3u8',
  '#EXTINF:-1 tvg-id="TVCultura.br@SD" group-title="Education;Kids",TV Cultura',
  'https://exemplo.com/cultura.m3u8',
].join('\n');

describe('aba Ao Vivo: SuperFlix + iptv-org do Brasil', () => {
  let superflixOk = true;
  let iptvOk = true;

  beforeEach(() => {
    localStorage.clear();
    superflixOk = true;
    iptvOk = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === IPTV_BR_URL) return iptvOk ? new Response(M3U) : new Response('x', { status: 500 });
      if (url.includes('superflixapi')) {
        if (!superflixOk) throw new TypeError('Failed to fetch'); // no navegador: CORS
        return new Response(JSON.stringify(SUPERFLIX));
      }
      return new Response('?', { status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('junta as duas fontes: SuperFlix primeiro, depois os do iptv-org com link direto', async () => {
    const lista = await fetchAoVivo(true);
    expect(lista.map(c => c.name)).toEqual(['ESPN', 'A&E', 'SporTV 2', 'TV Cultura']);
    expect(lista[0]).toMatchObject({ embed: 'https://sf/canal/espn', category: 'Esportes' });
    expect(lista[0].url).toBeUndefined();
    expect(lista[2]).toMatchObject({ embed: '', url: 'https://exemplo.com/sportv2.m3u8', category: 'Esportes', country: 'br' });
  });

  it('as categorias se juntam pelo nome (Sports do iptv-org = Esportes do SuperFlix)', async () => {
    const lista = await fetchAoVivo(true);
    expect(categoriesOf(lista)).toEqual(['Educação', 'Esportes', 'Infantil', 'Variedades']);
    expect(filtrarCanais(lista, 'Esportes', '').map(c => c.name)).toEqual(['ESPN', 'SporTV 2']);
    expect(filtrarCanais(lista, 'Infantil', '').map(c => c.name)).toEqual(['TV Cultura']);
  });

  it('SuperFlix fora do ar (navegador sem CORS) → mostra só os do iptv-org', async () => {
    superflixOk = false;
    const lista = await fetchAoVivo(true);
    expect(lista.map(c => c.name)).toEqual(['SporTV 2', 'TV Cultura']);
  });

  it('iptv-org fora do ar → mostra só os do SuperFlix', async () => {
    iptvOk = false;
    const lista = await fetchAoVivo(true);
    expect(lista.map(c => c.name)).toEqual(['ESPN', 'A&E']);
  });

  it('as duas fora → erro (a tela mostra "Tentar de novo")', async () => {
    superflixOk = false;
    iptvOk = false;
    await expect(fetchAoVivo(true)).rejects.toBeTruthy();
  });
});

describe('aba Ao Vivo: filtro', () => {
  const canais: Channel[] = [
    doIptv({ url: 'https://a/1.m3u8', name: 'Câmara dos Deputados', logo: '', categories: ['Legislativo', 'Notícias'], country: 'br' }),
    doIptv({ url: 'https://a/2.m3u8', name: 'CNN', logo: '', categories: ['Notícias'], country: 'us' }),
  ];

  it('busca sem diferenciar acento nem maiúscula', () => {
    expect(filtrarCanais(canais, null, 'camara').map(c => c.name)).toEqual(['Câmara dos Deputados']);
    expect(filtrarCanais(canais, null, '  cNn ').map(c => c.name)).toEqual(['CNN']);
  });

  it('canal com várias categorias aparece em todas', () => {
    expect(filtrarCanais(canais, 'Notícias', '').length).toBe(2);
    expect(filtrarCanais(canais, 'Legislativo', '').map(c => c.name)).toEqual(['Câmara dos Deputados']);
    expect(categoriesOf(canais)).toEqual(['Legislativo', 'Notícias']);
  });
});
