// Regras da captura do link e do resolvedor (W2), sem Electron: dá pra testar com node --test (regrasCaptura.test.cjs).
// São as decisões do APK: StreamSnifferPlugin.java (o que é vídeo, o que é lixo, quando sondar), ResolverPlugin.java
// (navegação da janela escondida) e OptionMsg.java (recados WMOPT do script do site). Quem usa é o captura.ts.

// Nunca é o vídeo: aposta, anúncio, rastreador (= BLOCKED_HOSTS).
const BLOQUEADOS = [
  'cloudflare-terms-of-service-abuse', 'brwin.games',
  'doubleclick.net', 'googlesyndication.com', 'adservice.', 'popads.', 'popcash.',
  'propellerads.', 'propu.', 'adnxs.', 'onclickalgo.', 'hilltopads.', 'juicyads.',
  'exoclick.', 'trafficjunky.', 'mgid.', 'revcontent.', 'outbrain.', 'taboola.',
  'redgarto.', 'blacked.com', 'masonry.blacked', 'clickadu.', 'adsterra.',
  'monetag.', 'galaksion.', 'trafficstars.', 'eroadvertising.', 'vast.',
];
// Caminho de criativo de anúncio, mesmo em CDN neutra (= AD_PATHS).
const CAMINHOS_DE_ANUNCIO = ['/gambling/', '/interstitial/', '/notifications/', '/creatives/', '/adasset'];
// Servem vídeo, mas nunca o conteúdo: pré-roll e trailer (= NOT_CONTENT_HOSTS).
const NAO_CONTEUDO = ['bannerflow.net', 'betano.', 'gmlinteractive.'];
// Quebram a página ou só rastreiam (= KILL_RES): a janela escondida nem carrega.
const DERRUBAR = [
  'disable-devtool', 'metricas.site', 'whos.amung', 'amung.us', 'pixel.morphify', 'morphify.net', 'histats',
  'static.cloudflareinsights', 'google-analytics.com', 'googletagmanager.com',
];

export const semQuery = (url: string): string => { const q = url.indexOf('?'); return q >= 0 ? url.slice(0, q) : url; };

export function bloqueado(url: string): boolean {
  const u = url.toLowerCase();
  return BLOQUEADOS.some((b) => u.includes(b));
}

const caminhoDeAnuncio = (u: string): boolean => CAMINHOS_DE_ANUNCIO.some((p) => u.includes(p));

/** Recurso que a janela escondida não carrega (anti-devtools, rastreador, anúncio). */
export function derrubar(url: string): boolean {
  const u = url.toLowerCase();
  return DERRUBAR.some((k) => u.includes(k)) || bloqueado(u) || caminhoDeAnuncio(u);
}

/** Vídeo que nunca é o conteúdo: pré-roll, pedaço cifrado do Abyss (/sora/) e trailer do YouTube. */
export function naoEConteudo(url: string): boolean {
  const u = url.toLowerCase();
  if (NAO_CONTEUDO.some((h) => u.includes(h))) return true;
  if (u.includes('/sora/')) return true;
  return u.includes('googlevideo.com') && u.includes('source=youtube');
}

/** Link tocável pela extensão (= looksLikeVideo): segmento e init ficam de fora (o master já os busca). */
export function pareceVideo(url: string): boolean {
  if (bloqueado(url)) return false;
  const u = url.toLowerCase();
  if (caminhoDeAnuncio(u)) return false;
  const p = semQuery(u);
  if (p.includes('seg-') || p.includes('/seg') || p.includes('init-') || p.includes('/init.') || p.includes('chunk')
    || p.endsWith('.ts') || p.endsWith('.m4s')) return false;
  if (/\.(m3u8|mpd|mp4|mkv|webm|m4v|mov|avi|flv)$/.test(p)) return true;
  return u.includes('master.m3u8') || u.includes('.m3u8') || u.includes('.mpd');
}

/** Pedido que não vale sondar (= skipProbe): recurso óbvio e o master.txt de uso único do player final. */
export function pularSonda(url: string): boolean {
  const p = semQuery(url.toLowerCase());
  if (p.includes('xn--tckasiu6cvova0eb5fua2449g98vg.') && p.endsWith('master.txt')) return true;
  if (p.includes('seg-') || p.includes('/seg') || p.includes('init-') || p.includes('/init.') || p.includes('chunk') || p.endsWith('.m4s')) return true;
  return /\.(js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|ts|html|json|php)$/.test(p) || p.startsWith('data:') || p.startsWith('blob:');
}

export function mimeDe(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('.m3u8') || u.includes('master') || u.includes('/manifest')) return 'application/vnd.apple.mpegurl';
  if (u.includes('.mpd')) return 'application/dash+xml';
  return 'video/mp4';
}

export function tipoDeVideo(ct: string | null | undefined): boolean {
  const c = (ct ?? '').toLowerCase();
  return c.includes('mpegurl') || c.includes('dash+xml') || c.includes('video/') || c.includes('x-matroska') || c.includes('mp2t');
}

/** Começo do arquivo diz o que é, quando o Content-Type é genérico: playlist HLS ou MP4. */
export function mimePeloComeco(ct: string | null | undefined, comeco: string): string | null {
  const c = (ct ?? '').toLowerCase();
  if (c && !c.includes('octet-stream') && !c.includes('text/') && !c.includes('application/binary')) return null;
  if (comeco.includes('#EXTM3U')) return 'application/vnd.apple.mpegurl';
  if (comeco.includes('ftyp')) return 'video/mp4';
  return null;
}

// Recalculados a cada conexão ou atrapalham a repetição (= dropHeader).
const NAO_REPETIR = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'range', 'if-range',
  'transfer-encoding', 'upgrade', 'keep-alive']);

/** Cabeçalhos que o navegador usou no pedido do vídeo e que o player repete (Referer, Origin, sec-*, token…). */
export function cabecalhosDoLink(h: Record<string, string> | undefined): Record<string, string> {
  const r: Record<string, string> = {};
  // sec-* (sec-ch-ua, Sec-Fetch-*) quem monta é o próprio Chromium: copiados num pedido novo, ele recusa
  // (net::ERR_INVALID_ARGUMENT, visto na sonda do master.txt da Fonte 1 em 07/11/2026).
  for (const [k, v] of Object.entries(h ?? {})) {
    const n = k.toLowerCase();
    if (typeof v === 'string' && !NAO_REPETIR.has(n) && !n.startsWith('sec-')) r[k] = v;
  }
  return r;
}

export function cabecalho(h: Record<string, string> | undefined, nome: string): string | undefined {
  const alvo = nome.toLowerCase();
  for (const [k, v] of Object.entries(h ?? {})) if (k.toLowerCase() === alvo) return v;
  return undefined;
}

/** Maior altura de imagem anunciada num master HLS (RESOLUTION=1920x1080 → "1080p"); "" sem nenhuma. */
export function qualidadeDoMaster(texto: string): string {
  let max = 0;
  for (const m of texto.matchAll(/RESOLUTION=\d{2,4}x(\d{2,4})/g)) max = Math.max(max, Number(m[1]));
  return max > 0 ? `${max}p` : '';
}

/** Campo de um recado `k=2|stage=player|host=x` (= OptionMsg.field). */
export function campo(resto: string, chave: string): string | undefined {
  for (const parte of resto.split('|')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i) === chave) return parte.slice(i + 1);
  }
  return undefined;
}

export function kDoRecado(resto: string): number {
  const v = Number.parseInt(campo(resto, 'k') ?? '', 10);
  return Number.isFinite(v) ? v : -1;
}

/** Mesmo site = os 2 últimos rótulos iguais (www.embedplay.one ~ embedplay.one). */
export function mesmoSite(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = a.split('.'), y = b.split('.');
  return x.length >= 2 && y.length >= 2 && x[x.length - 1] === y[y.length - 1] && x[x.length - 2] === y[y.length - 2];
}

/** A janela escondida só navega (frame principal) pro mesmo site da página atual ou pra um host de hop; o resto é
 *  propaganda trocando a página (= shouldOverrideUrlLoading). Esquema que não é http(s) também não. */
export function navegacaoPermitida(destino: string, atual: string, hopHosts: readonly string[]): boolean {
  let host = '';
  try {
    const u = new URL(destino);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch { return false; }
  let hostAtual = '';
  try { hostAtual = new URL(atual).hostname.toLowerCase(); } catch { /* página em branco */ }
  return mesmoSite(host, hostAtual) || hopHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Página mínima com a fonte num iframe (Pomfy só abre dentro de iframe: aberta direto dá 403). */
export function paginaComIframe(url: string): string {
  const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + `<body style="margin:0;background:#000"><iframe src="${src}" style="border:0;width:100vw;height:100vh"`
    + ' allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe></body></html>';
}

// Tempo máximo de uma opção desde que ela começou, mesmo com progresso (= OPT_MAX_MS).
export const OPCAO_MAX_MS = 90000;

/** Recado de clique de verdade (`WMCFTAP|x|y|vw|vh` da verificação, `WMCLICK|…` da lista de servidores): ponto em
 *  pixels da janela, na escala do tamanho real dela. null = recado torto. */
export function pontoDoClique(msg: string, largura: number, altura: number): { x: number; y: number } | null {
  const m = /^WM(?:CFTAP|CLICK)\|(-?\d+)\|(-?\d+)\|(\d+)\|(\d+)/.exec(msg);
  if (!m) return null;
  const [x, y, vw, vh] = m.slice(1).map(Number);
  if (vw <= 0 || vh <= 0 || largura <= 0 || altura <= 0 || x < 0 || y < 0 || x > vw || y > vh) return null;
  return { x: Math.round(x * (largura / vw)), y: Math.round(y * (altura / vh)) };
}
