import { describe, it, expect, vi, beforeEach } from 'vitest';

// CapacitorHttp falso: cada teste diz o que cada endereço responde; os pedidos ficam anotados.
const native = { on: true };
type Pedido = { url: string; method: string; headers: Record<string, string>; data?: Record<string, unknown> };
const pedidos: Pedido[] = [];
let rotas: (p: Pedido) => { status: number; data: string } = () => ({ status: 404, data: '' });
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on },
  CapacitorHttp: {
    request: async (p: Pedido) => { pedidos.push(p); return rotas(p); },
  },
}));

import {
  contentIdSerie, serieSemEpisodio, opcoesDublado, destinoDoVideo, desfazerPacker, masterDoFsplay, urlSegura,
  resolverSerieFshd, FSHD_MAX_PLAYERS, MIME_HLS,
} from './fshdApi';

// Mesma forma das páginas reais medidas em 20/10/2026 (Breaking Bad T1E1), com conteúdo de teste.
const PAGINA = `<div class="episodeOption " data-contentid="22627"></div>
  <div class="episodeOption active" data-contentid="22628"></div><div class="episodeOption " data-contentid="22629"></div>`;
const VIDEO_FSPLAY = `<script>window.location.href = "https://112234152.xyz/player/index.php?data=abc123";</script>`;
const VIDEO_ABYSS = `<script>window.location.href = "https://abyssplayer.com/iSyIBGz1N?sub=x.srt&lang=Português (PT-BR)";</script>`;
const FSPLAY = String.raw`<script>var player_base_url = "https://112234152.xyz/player";</script>
<script>eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0 2="3";4(2,{"5":"\\/6\\/3\\/7.8","9":"1"})',36,10,'var||vhash|ab12|FirePlayer|videoUrl|hls|master|txt|videoServer'.split('|'),0,{}))</script>`;

describe('Fonte 3 por API — leitura das páginas', () => {
  it('content id do episódio aberto; episódio inexistente = lista sem nenhum marcado', () => {
    expect(contentIdSerie(PAGINA)).toBe('22628');
    expect(contentIdSerie('<div></div>')).toBeNull();
    expect(serieSemEpisodio(PAGINA.replace(' active', ' '))).toBe(true);
    expect(serieSemEpisodio(PAGINA)).toBe(false);
    expect(serieSemEpisodio('<div></div>')).toBe(false);
  });

  it('api/options: só as dubladas (type 1), na ordem da API', () => {
    expect(opcoesDublado({ options: [{ ID: 226224, type: 2 }, { ID: 226227, type: 1 }, { ID: 226221, type: 1 }] })).toEqual({ dub: [226227, 226221], total: 3 });
    expect(opcoesDublado({ options: [{ ID: 1, type: 2 }] })).toEqual({ dub: [], total: 1 });
    expect(opcoesDublado({ message: 'Ocorreu um erro inesperado.' })).toEqual({ dub: [], total: 0 });
    expect(opcoesDublado(null)).toEqual({ dub: [], total: 0 });
  });

  it('página do vídeo: endereço do window.location.href', () => {
    expect(destinoDoVideo(VIDEO_FSPLAY)).toBe('https://112234152.xyz/player/index.php?data=abc123');
    expect(destinoDoVideo('<html></html>')).toBeNull();
  });

  it('desfaz o script compactado sem rodar JavaScript e acha o master do Fsplay', () => {
    expect(desfazerPacker(FSPLAY)).toBe(String.raw`var vhash="ab12";FirePlayer(vhash,{"videoUrl":"\\/hls\\/ab12\\/master.txt","videoServer":"1"})`);
    expect(masterDoFsplay(FSPLAY)).toEqual({ master: 'https://112234152.xyz/player/hls/ab12/master.txt', referer: 'https://112234152.xyz/' });
    expect(desfazerPacker('<script>var x=1</script>')).toBeNull();
    expect(masterDoFsplay(FSPLAY.replace(/var player_base_url[^;]+;/, ''))).toBeNull();
    expect(desfazerPacker(FSPLAY.replace("',36,10,'", "',95,10,'"))).toBeNull();   // base fora do formato conhecido
  });

  it('URL com espaço/acento crus vira percent-encoding; o resto fica igual', () => {
    expect(urlSegura('https://a.xyz/b?lang=Português (PT-BR)&x=%41')).toBe('https://a.xyz/b?lang=Portugu%C3%AAs%20(PT-BR)&x=%41');
  });
});

describe('Fonte 3 por API — cadeia da série (CapacitorHttp falso)', () => {
  beforeEach(() => { native.on = true; pedidos.length = 0; });

  const site = (o: { pagina?: number; opcoes?: unknown; players?: (id: unknown) => { status: number; data: string }; video?: Record<string, string> }) =>
    (p: Pedido) => {
      if (p.url.startsWith('https://fshd.link/serie/')) return { status: o.pagina ?? 200, data: o.pagina && o.pagina !== 200 ? '' : PAGINA };
      if (p.url.endsWith('/api/options')) return { status: 200, data: JSON.stringify(o.opcoes ?? { options: [{ ID: 162759, type: 1 }] }) };
      if (p.url.endsWith('/api/players')) return o.players ? o.players(p.data?.video_id) : { status: 200, data: JSON.stringify({ video_url: `https://fshd.link/video/tok${p.data?.video_id}` }) };
      if (p.url.startsWith('https://fshd.link/video/')) return { status: 200, data: o.video?.[p.url] ?? VIDEO_FSPLAY };
      if (p.url.startsWith('https://112234152.xyz/player/index.php')) return { status: 200, data: FSPLAY };
      return { status: 404, data: '' };
    };

  it('acha o master do Fsplay e devolve o link com o Referer do player', async () => {
    rotas = site({});
    const r = await resolverSerieFshd({ imdbId: 'tt0903747', season: 1, episode: 1 });
    expect(r).toEqual({
      tipo: 'achou',
      link: {
        url: 'https://112234152.xyz/player/hls/ab12/master.txt', mime: MIME_HLS, referer: 'https://112234152.xyz/',
        headers: { Referer: 'https://112234152.xyz/', Origin: 'https://112234152.xyz' }, provider: 'fshd', option: 'FsPlay',
      },
    });
    expect(pedidos.map(p => `${p.method} ${p.url}`)).toEqual([
      'GET https://fshd.link/serie/tt0903747/1/1',
      'POST https://fshd.link/api/options',
      'POST https://fshd.link/api/players',
      'GET https://fshd.link/video/tok162759',
      'GET https://112234152.xyz/player/index.php?data=abc123',
    ]);
    expect(pedidos[1].data).toEqual({ content_id: 22628, content_type: '2' });
    expect(pedidos[2].data).toEqual({ content_info: 22628, content_type: '2', video_id: 162759 });
    expect(pedidos[1].headers).toMatchObject({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Referer: 'https://fshd.link/serie/tt0903747/1/1' });
    expect(pedidos[3].headers.Referer).toBe('https://fshd.link/serie/tt0903747/1/1');
  });

  it('episódio que o FSHD não tem: 404 = "não tem" (pula pra próxima fonte)', async () => {
    rotas = site({ pagina: 404 });
    expect(await resolverSerieFshd({ imdbId: 'tt14976292', season: 1, episode: 1 })).toEqual({ tipo: 'nao-tem', motivo: 'f3-404' });
    expect(pedidos).toHaveLength(1);
  });

  it('só legendado = "não tem" sem chamar o api/players', async () => {
    rotas = site({ opcoes: { options: [{ ID: 9, type: 2 }] } });
    expect(await resolverSerieFshd({ imdbId: 'tt1', season: 1, episode: 1 })).toEqual({ tipo: 'nao-tem', motivo: 'f3-so-legendado' });
    expect(pedidos.some(p => p.url.endsWith('/api/players'))).toBe(false);
  });

  it('limite do site (429) cai no WebView na hora', async () => {
    rotas = site({ players: () => ({ status: 429, data: '{"message":"Limite atingido. Tente novamente mais tarde."}' }) });
    expect(await resolverSerieFshd({ imdbId: 'tt1', season: 1, episode: 1 })).toEqual({ tipo: 'webview', motivo: 'limite-429' });
  });

  it('1ª dublada é Abyss, a 2ª é Fsplay → acha pela 2ª', async () => {
    rotas = site({ opcoes: { options: [{ ID: 1, type: 1 }, { ID: 2, type: 1 }] }, video: { 'https://fshd.link/video/tok1': VIDEO_ABYSS } });
    const r = await resolverSerieFshd({ imdbId: 'tt1', season: 2, episode: 3 });
    expect(r.tipo).toBe('achou');
    expect(pedidos.filter(p => p.url.endsWith('/api/players')).map(p => p.data?.video_id)).toEqual([1, 2]);
  });

  it(`nunca passa de ${FSHD_MAX_PLAYERS} chamadas ao api/players por play; sem Fsplay → WebView`, async () => {
    rotas = site({ opcoes: { options: [1, 2, 3, 4].map(ID => ({ ID, type: 1 })) }, video: Object.fromEntries([1, 2, 3, 4].map(i => [`https://fshd.link/video/tok${i}`, VIDEO_ABYSS])) });
    expect(await resolverSerieFshd({ imdbId: 'tt1', season: 1, episode: 1 })).toEqual({ tipo: 'webview', motivo: 'sem-fsplay' });
    expect(pedidos.filter(p => p.url.endsWith('/api/players'))).toHaveLength(FSHD_MAX_PLAYERS);
  });

  it('cancelado no meio (fechou o título) para no passo seguinte', async () => {
    const sinal = { cancelado: false };
    rotas = (p) => { if (p.url.endsWith('/api/options')) sinal.cancelado = true; return site({})(p); };
    expect(await resolverSerieFshd({ imdbId: 'tt1', season: 1, episode: 1 }, sinal)).toEqual({ tipo: 'webview', motivo: 'cancelado' });
    expect(pedidos.some(p => p.url.endsWith('/api/players'))).toBe(false);
  });

  it('fora do aparelho (navegador) não tenta: CORS', async () => {
    native.on = false;
    expect(await resolverSerieFshd({ imdbId: 'tt1', season: 1, episode: 1 })).toEqual({ tipo: 'webview', motivo: 'sem-nativo' });
    expect(pedidos).toHaveLength(0);
  });
});
