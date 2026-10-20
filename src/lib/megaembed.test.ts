import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// CapacitorHttp falso: cada teste diz o que cada endereço responde; os pedidos ficam anotados.
const native = { on: true };
type Pedido = { url: string; method: string; headers: Record<string, string>; responseType?: string };
type Resp = { status: number; data: string; headers?: Record<string, string> };
const pedidos: Pedido[] = [];
let rotas: (p: Pedido) => Resp = () => ({ status: 404, data: '' });
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on },
  CapacitorHttp: {
    request: async (p: Pedido) => { pedidos.push(p); return { headers: {}, ...rotas(p) }; },
  },
}));

import {
  urlMegaEmbed, opcoesDaPagina, paginaRestrita, resolucaoDoMaster, dimensoesDoMp4, base64ParaBytes, ordenarPorQualidade, rotuloDe,
  resolverMegaEmbed, MEGA_REFERER, MIME_HLS, MIME_MP4, MEGA_BYTES_MP4,
} from './megaembed';
import { PROVIDERS, PROVIDER_HOSTS, rotuloDaFonte } from './players';

// ── MP4 de mentira: só as caixas que o app lê (ftyp + moov → mvhd + trak → tkhd) ──────────────────────────────────
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
const caixa = (tipo: string, corpo: number[]) => [...u32(8 + corpo.length), ...ascii(tipo), ...corpo];
function tkhd(w: number, h: number, versao = 0) {
  const corpo = new Array(versao === 0 ? 84 : 96).fill(0);   // caixa de 92 B (versão 0) ou 104 B (versão 1)
  corpo[0] = versao;
  corpo.splice(corpo.length - 8, 8, ...u32(w * 65536), ...u32(h * 65536));   // ponto fixo 16.16
  return caixa('tkhd', corpo);
}
const ftyp = caixa('ftyp', [...ascii('isom'), 0, 0, 2, 0, ...ascii('isomiso2avc1mp41')]);
const mp4 = (...traks: number[][]) => new Uint8Array([...ftyp, ...caixa('moov', [...caixa('mvhd', new Array(100).fill(0)), ...traks.map(t => caixa('trak', t)).flat()])]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

// Mesma forma das páginas reais medidas em 20/10/2026 (Vingadores: Ultimato, 4 opções), com endereços de teste.
const pagina = (sources: unknown[]) => `<html><head><title>Vingadores: Ultimato</title></head><body><div id="player"></div>
<script>const sources = ${JSON.stringify(sources)};</script><script src="https://megaembed.com/player/megatube.js?v=2.8"></script></body></html>`;
const ST = 'https://streamtape.com/get_video?id=AbC&expires=1&ip=X&token=Y&stream=1';
const HLS808 = 'https://s1-s501740.97bf1.com/hls/Pvb/master.m3u8?token=t';
const IPTV = 'http://www-fontedecanais-live.exemplo.com:80/movies/1798/318448.mp4?username=u&token=t';
const HLS360 = 'https://solitary-field-9699.playercdnx.workers.dev/includes/hls.php?url=abc';
const ULTIMATO = [
  { file: ST, type: 'mp4', label: 'Opção 1', ipLocked: true },
  { file: HLS808, type: 'hls', label: 'Opção 2' },
  { file: IPTV, type: 'mp4', label: 'Opção 3' },
  { file: HLS360, type: 'hls', label: 'Opção 4' },
];
// Texto da página real de 20/10/2026 (ids que o MegaEmbed usa pra canal de TV), sem o estilo.
const RESTRITA = `<html><head><title>Acesso Restrito - MEGAEMBED</title></head><body><h1>Domínio Não Autorizado</h1>
<p>A reprodução deste canal de TV está bloqueada para esta origem externa.</p></body></html>`;
const MASTER = (w: number, h: number) => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=${w}x${h}\nindex.m3u8\n`;

function rotasUltimato(p: Pedido): Resp {
  if (p.url === 'https://megaembed.com/embed/299534') return { status: 200, data: pagina(ULTIMATO) };
  if (p.url === ST) return { status: 200, data: '<html>video not found</html>', headers: { 'Content-Type': 'text/html; charset=UTF-8' } };
  if (p.url === HLS808) return { status: 200, data: MASTER(1920, 808), headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } };
  if (p.url === HLS360) return { status: 200, data: MASTER(640, 360), headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } };
  if (p.url === IPTV && p.method === 'HEAD') return { status: 200, data: '', headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' } };
  if (p.url === IPTV) return { status: 206, data: b64(mp4(tkhd(1920, 804))), headers: { 'Content-Type': 'video/mp4' } };
  return { status: 404, data: '' };
}

beforeEach(() => { pedidos.length = 0; native.on = true; rotas = () => ({ status: 404, data: '' }); });

describe('Fonte 7 (MegaEmbed) — lista de fontes', () => {
  it('volta como Fonte 7, no fim, pelo TMDB id; sem TMDB não aparece', () => {
    const p = PROVIDERS.find(x => x.id === 'megaembed')!;
    expect(PROVIDERS[PROVIDERS.length - 1].id).toBe('megaembed');
    expect(rotuloDaFonte('megaembed')).toBe('7 · MegaEmbed');
    expect(p.build({ type: 'movie', tmdbId: 299534 })).toBe('https://megaembed.com/embed/299534');
    expect(p.build({ type: 'tv', tmdbId: 1396, season: 1, episode: 2 })).toBe('https://megaembed.com/embed/1396/1/2');
    expect(p.build({ type: 'tv', tmdbId: 1396 })).toBe('https://megaembed.com/embed/1396/1/1');
    expect(p.build({ type: 'movie', imdbId: 'tt4154796' })).toBeNull();
    expect(urlMegaEmbed({ tmdbId: 123542, type: 'tv', season: 1, episode: 1 })).toBe('https://megaembed.com/embed/123542/1/1');
  });

  it('o modo Servidor da web pode abrir a MegaEmbed (frame-src do vercel.json)', () => {
    expect(PROVIDER_HOSTS).toContain('https://megaembed.com');
    const frameSrc = /frame-src ([^;]+);/.exec(readFileSync('vercel.json', 'utf8'))?.[1] ?? '';
    expect(frameSrc.split(' ')).toContain('https://megaembed.com');
  });
});

describe('Fonte 7 — leitura da página e dos arquivos (puras)', () => {
  it('sources da página: na ordem, sem repetidas e só endereço http(s)', () => {
    const ops = opcoesDaPagina(pagina([...ULTIMATO, { file: HLS808, type: 'hls', label: 'Opção 5' }, { file: 'javascript:x', type: 'hls', label: 'x' }]));
    expect(ops?.map(o => o.label)).toEqual(['Opção 1', 'Opção 2', 'Opção 3', 'Opção 4']);
    expect(ops?.[2]).toEqual({ file: IPTV, type: 'mp4', label: 'Opção 3' });
  });

  it('lista vazia = não tem o título; sem a lista (ou quebrada) = página mudou → null', () => {
    expect(opcoesDaPagina(pagina([]))).toEqual([]);
    expect(opcoesDaPagina('<html><title>Player</title></html>')).toBeNull();
    expect(opcoesDaPagina('<script>const sources = [{file: x}];</script>')).toBeNull();
  });

  it('página "Acesso Restrito · Domínio Não Autorizado" (canal de TV) é reconhecida', () => {
    expect(paginaRestrita(RESTRITA)).toBe(true);
    expect(opcoesDaPagina(RESTRITA)).toBeNull();
    expect(paginaRestrita(pagina(ULTIMATO))).toBe(false);
  });

  it('master: a maior resolução pela área; lista de pedaços sem variantes = null', () => {
    expect(resolucaoDoMaster(`#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=854x480\na\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nb\n#EXT-X-STREAM-INF:RESOLUTION=640x360\nc`)).toEqual({ w: 1280, h: 720 });
    expect(resolucaoDoMaster('#EXTM3U\n#EXTINF:10,\nseg-1.ts\n')).toBeNull();
  });

  it('MP4: tamanho da 1ª faixa com imagem (a de áudio vem 0×0), versões 0 e 1 da caixa', () => {
    expect(dimensoesDoMp4(mp4(tkhd(1920, 804)))).toEqual({ w: 1920, h: 804 });
    expect(dimensoesDoMp4(mp4(tkhd(0, 0), tkhd(1280, 720)))).toEqual({ w: 1280, h: 720 });
    expect(dimensoesDoMp4(mp4(tkhd(1281, 534, 1)))).toEqual({ w: 1281, h: 534 });
    expect(dimensoesDoMp4(new Uint8Array([...ftyp, 0, 0, 0, 8, ...ascii('mdat')]))).toBeNull();   // moov no fim do arquivo
  });

  it('base64 do CapacitorHttp → bytes', () => {
    const b = mp4(tkhd(640, 360));
    expect(Array.from(base64ParaBytes(b64(b)))).toEqual(Array.from(b));
  });

  it('ordem: mais pixels primeiro, sem resolução no fim, empate na ordem da página', () => {
    const xs = [{ i: 0, dim: null }, { i: 1, dim: { w: 1280, h: 720 } }, { i: 2, dim: { w: 1920, h: 804 } }, { i: 3, dim: { w: 1280, h: 720 } }];
    expect(ordenarPorQualidade(xs).map(x => x.i)).toEqual([2, 1, 3, 0]);
    expect(rotuloDe({ w: 1920, h: 804 })).toBe('804p');
    expect(rotuloDe(null)).toBe('');
  });
});

describe('Fonte 7 — cadeia por HTTP (CapacitorHttp falso)', () => {
  it('Ultimato: entram as 3 que abrem, da melhor pra pior; a do streamtape (página de erro) fica de fora', async () => {
    rotas = rotasUltimato;
    const r = await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' });
    expect(r.tipo).toBe('achou');
    if (r.tipo !== 'achou') return;
    expect(r.links.map(l => [l.url, l.quality, l.mime, l.option])).toEqual([
      [HLS808, '808p', MIME_HLS, 'Opção 2'],
      [IPTV, '804p', MIME_MP4, 'Opção 3'],
      [HLS360, '360p', MIME_HLS, 'Opção 4'],
    ]);
    for (const l of r.links) {
      expect(l.provider).toBe('megaembed');
      expect(l.referer).toBe(MEGA_REFERER);
      expect(l.headers).toEqual({ Referer: MEGA_REFERER, Origin: 'https://megaembed.com' });
    }
    // MP4: HEAD primeiro; o começo do arquivo só com Range (sem ele viria o filme inteiro)
    const iptv = pedidos.filter(p => p.url === IPTV);
    expect(iptv.map(p => p.method)).toEqual(['HEAD', 'GET']);
    expect(iptv[1].headers.Range).toBe(`bytes=0-${MEGA_BYTES_MP4}`);
    expect(iptv[1].responseType).toBe('arraybuffer');
    // streamtape: só o HEAD, nunca o arquivo
    expect(pedidos.filter(p => p.url === ST).map(p => p.method)).toEqual(['HEAD']);
  });

  it('MP4 sem Accept-Ranges entra sem resolução (não baixa o começo) e vai pro fim da lista', async () => {
    rotas = p => (p.url === IPTV && p.method === 'HEAD' ? { status: 200, data: '', headers: { 'content-type': 'video/mp4' } } : rotasUltimato(p));
    const r = await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' });
    expect(r.tipo === 'achou' && r.links.map(l => l.url)).toEqual([HLS808, HLS360, IPTV]);
    expect(pedidos.filter(p => p.url === IPTV).map(p => p.method)).toEqual(['HEAD']);
  });

  it('série: endereço com temporada e episódio; IPTV de 1 opção (Link Click)', async () => {
    const LC = 'http://www-fontedecanais-live.exemplo.com/series/link%20click/209622.mp4?username=u&token=t';
    rotas = p => {
      if (p.url === 'https://megaembed.com/embed/123542/1/1') return { status: 200, data: pagina([{ file: LC, type: 'mp4', label: 'Opção 1' }]) };
      if (p.url === LC && p.method === 'HEAD') return { status: 200, data: '', headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' } };
      if (p.url === LC) return { status: 206, data: b64(mp4(tkhd(1281, 534))) };
      return { status: 404, data: '' };
    };
    const r = await resolverMegaEmbed({ tmdbId: 123542, type: 'tv', season: 1, episode: 1 });
    expect(r).toEqual({ tipo: 'achou', links: [expect.objectContaining({ url: LC, quality: '534p', mime: MIME_MP4, option: 'Opção 1' })] });
  });

  it('não tem: lista vazia, 404 ou nenhuma opção abriu → pula pra próxima fonte', async () => {
    rotas = () => ({ status: 200, data: pagina([]) });
    expect(await resolverMegaEmbed({ tmdbId: 999999999, type: 'movie' })).toEqual({ tipo: 'nao-tem', motivo: 'f7-sem-opcao' });
    rotas = () => ({ status: 404, data: '' });
    expect(await resolverMegaEmbed({ tmdbId: 1, type: 'movie' })).toEqual({ tipo: 'nao-tem', motivo: 'f7-404' });
    rotas = () => ({ status: 403, data: RESTRITA });   // como veio no emulador (Grande Hotel, TMDB 5)
    expect(await resolverMegaEmbed({ tmdbId: 5, type: 'movie' })).toEqual({ tipo: 'nao-tem', motivo: 'f7-restrito' });
    rotas = () => ({ status: 200, data: RESTRITA });
    expect(await resolverMegaEmbed({ tmdbId: 3, type: 'movie' })).toEqual({ tipo: 'nao-tem', motivo: 'f7-restrito' });
    rotas = p => (p.url.startsWith('https://megaembed.com/') ? { status: 200, data: pagina(ULTIMATO) } : { status: 403, data: '' });
    expect(await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' })).toEqual({ tipo: 'nao-tem', motivo: 'f7-nenhuma-abriu n=4' });
  });

  it('fora do previsto → WebView de sempre: erro do site, página sem a lista, fora do app, cancelado', async () => {
    rotas = () => ({ status: 503, data: '' });
    expect(await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' })).toEqual({ tipo: 'webview', motivo: 'pagina-503' });
    rotas = () => ({ status: 200, data: '<html><title>Player</title></html>' });
    expect(await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' })).toEqual({ tipo: 'webview', motivo: 'sem-lista' });
    native.on = false;
    expect(await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' })).toEqual({ tipo: 'webview', motivo: 'sem-nativo' });
    native.on = true;
    rotas = rotasUltimato;
    expect(await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' }, { cancelado: true })).toEqual({ tipo: 'webview', motivo: 'cancelado' });
  });

  it('opção que dá erro de rede fica de fora sem derrubar as outras', async () => {
    rotas = p => { if (p.url === HLS360) throw new Error('timeout'); return rotasUltimato(p); };
    const r = await resolverMegaEmbed({ tmdbId: 299534, type: 'movie' });
    expect(r.tipo === 'achou' && r.links.map(l => l.url)).toEqual([HLS808, IPTV]);
  });
});
