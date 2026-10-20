import { CapacitorHttp, Capacitor } from '@capacitor/core';
import type { SniffResult } from './streamSniffer';

// Fonte 3 (FS/HD) pela API do próprio site (20/10/2026, estudo do Nuvio; pedido dele "1 e 3"). A SÉRIE vai por HTTP,
// sem o WebView oculto clicar: página do episódio → content id → api/options (só dublado) → api/players → página do
// vídeo → player do Fsplay (FirePlayer, script compactado) → master.txt. O FILME continua no WebView: o FsPlay do filme
// manda pra um /bounce/ que responde 404 (quebrado no site) e os outros servidores (Abyss) precisam do motor do WebView.
// Qualquer coisa fora do previsto → 'webview' (o caminho de antes), nunca pior que hoje.

export const FSHD_BASE = 'https://fshd.link';
// O api/players responde 429 ("Limite atingido") depois de ~17 chamadas em ~20 min (medido 20/10/2026) → poucas por play.
export const FSHD_MAX_PLAYERS = 2;
export const FSHD_TIMEOUT_MS = 10000;   // por pedido
export const FSHD_PRAZO_MS = 25000;     // a cadeia inteira (quem chama cai no WebView depois disso)
export const MIME_HLS = 'application/vnd.apple.mpegurl';

export type FshdResultado =
  | { tipo: 'achou'; link: SniffResult }
  | { tipo: 'nao-tem'; motivo: string }
  | { tipo: 'webview'; motivo: string };

export interface AlvoSerie { imdbId: string; season: number; episode: number }

// ── leitura das páginas (puras) ─────────────────────────────────────────────────────────────────────────────────

// Página do episódio: o episódio aberto vem marcado com "active" na lista.
export function contentIdSerie(html: string): string | null {
  return html.match(/class="episodeOption active" data-contentid="(\d+)"/)?.[1] ?? null;
}

// Episódio que não existe cai na página da série sem nenhum episódio marcado (mesma regra do WebView, 'f3-sem-episodio').
export function serieSemEpisodio(html: string): boolean {
  return /class="episodeOption/.test(html) && !/class="episodeOption active"/.test(html);
}

// api/options → ids das opções DUBLADAS (type 1 = dublado, 2 = legendado), na ordem da API.
export function opcoesDublado(json: unknown): { dub: number[]; total: number } {
  const ops = (json as { options?: Array<{ ID?: unknown; type?: unknown }> } | null)?.options;
  if (!Array.isArray(ops)) return { dub: [], total: 0 };
  const dub = ops.filter(o => Number(o?.type) === 1 && Number(o?.ID) > 0).map(o => Number(o.ID));
  return { dub, total: ops.length };
}

// Página do vídeo (video_url): só redireciona com window.location.href pro servidor escolhido.
export function destinoDoVideo(html: string): string | null {
  return html.match(/window\.location\.href\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

// Desfaz o eval(function(p,a,c,k,e,d){…}('…',base,n,'w1|w2|…'.split('|'),…)) SEM rodar JavaScript: troca cada palavra
// codificada (número na base `a`) pela palavra da lista. Base acima de 62 não é o formato conhecido → null.
export function desfazerPacker(html: string): string | null {
  const m = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return null;
  const base = Number(m[2]), n = Number(m[3]);
  if (!(base >= 2 && base <= 62) || !(n > 0)) return null;
  const palavras = m[4].split('|');
  const alfa = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const emBase = (x: number) => { let s = ''; do { s = alfa[x % base] + s; x = Math.floor(x / base); } while (x > 0); return s; };
  const tabela = new Map<string, string>();
  for (let i = 0; i < n; i++) tabela.set(emBase(i), palavras[i] || emBase(i));
  return m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, w => tabela.get(w) ?? w);
}

// Player do Fsplay: `var player_base_url = "https://<host>/player"` + `"videoUrl":"\/hls\/<hash>\/master.txt"` dentro do
// script compactado → endereço do master. Os pedaços (outro host) só saem com o Referer do player.
export function masterDoFsplay(html: string): { master: string; referer: string } | null {
  const base = html.match(/var\s+player_base_url\s*=\s*"([^"]+)"/)?.[1];
  const js = desfazerPacker(html);
  const v = js?.match(/"videoUrl"\s*:\s*"([^"]+)"/)?.[1];
  if (!base || !v) return null;
  const caminho = v.replace(/\\/g, '');
  let origem: string;
  try { origem = new URL(base).origin; } catch { return null; }
  const master = /^https?:\/\//.test(caminho) ? caminho : base.replace(/\/+$/, '') + '/' + caminho.replace(/^\/+/, '');
  return { master, referer: origem + '/' };
}

// Espaço/acento cru na URL (o site escreve assim no window.location.href) → percent-encoding, sem mexer no resto.
export function urlSegura(u: string): string {
  return u.replace(/[^\x21-\x7e]/g, c => encodeURIComponent(c));
}

// ── rede ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Resposta { status: number; texto: string }

async function pedir(url: string, opts: { post?: Record<string, unknown>; cab?: Record<string, string> } = {}): Promise<Resposta> {
  const headers: Record<string, string> = { 'User-Agent': navigator.userAgent, ...(opts.cab ?? {}) };
  const res = await CapacitorHttp.request({
    url: urlSegura(url), method: opts.post ? 'POST' : 'GET', headers, data: opts.post,
    responseType: 'text', connectTimeout: FSHD_TIMEOUT_MS, readTimeout: FSHD_TIMEOUT_MS,
  });
  const texto = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
  return { status: res.status, texto };
}

function json(texto: string): unknown {
  try { return JSON.parse(texto); } catch { return null; }
}

// Série da Fonte 3 por HTTP. `sinal.cancelado` (fechou o título / trocou a fonte) para a cadeia no próximo passo.
export async function resolverSerieFshd(alvo: AlvoSerie, sinal: { cancelado: boolean } = { cancelado: false }): Promise<FshdResultado> {
  if (!Capacitor.isNativePlatform()) return { tipo: 'webview', motivo: 'sem-nativo' };   // no navegador o CORS barra
  const pagina = `${FSHD_BASE}/serie/${alvo.imdbId}/${alvo.season}/${alvo.episode}`;
  const p = await pedir(pagina, { cab: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  if (p.status === 404) return { tipo: 'nao-tem', motivo: 'f3-404' };
  if (p.status !== 200) return { tipo: 'webview', motivo: `pagina-${p.status}` };
  const cid = contentIdSerie(p.texto);
  if (!cid) return serieSemEpisodio(p.texto) ? { tipo: 'nao-tem', motivo: 'f3-sem-episodio' } : { tipo: 'webview', motivo: 'sem-content-id' };
  if (sinal.cancelado) return { tipo: 'webview', motivo: 'cancelado' };

  const xhr = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/json', Referer: pagina, Origin: FSHD_BASE };
  const o = await pedir(`${FSHD_BASE}/api/options`, { post: { content_id: Number(cid), content_type: '2' }, cab: xhr });
  if (o.status !== 200) return { tipo: 'webview', motivo: `options-${o.status}` };
  const { dub, total } = opcoesDublado(json(o.texto));
  if (!dub.length) return { tipo: 'nao-tem', motivo: total ? 'f3-so-legendado' : 'f3-sem-opcao' };

  for (const id of dub.slice(0, FSHD_MAX_PLAYERS)) {
    if (sinal.cancelado) return { tipo: 'webview', motivo: 'cancelado' };
    const pl = await pedir(`${FSHD_BASE}/api/players`, { post: { content_info: Number(cid), content_type: '2', video_id: id }, cab: xhr });
    if (pl.status === 429) return { tipo: 'webview', motivo: 'limite-429' };
    const video = (json(pl.texto) as { video_url?: string } | null)?.video_url;
    if (pl.status !== 200 || !video) continue;
    const v = await pedir(video, { cab: { Referer: pagina } });
    const destino = v.status === 200 ? destinoDoVideo(v.texto) : null;
    if (!destino || !/\/player\/index\.php/.test(destino)) continue;   // não é o Fsplay (ex.: Abyss) → próxima opção
    if (sinal.cancelado) return { tipo: 'webview', motivo: 'cancelado' };
    const fp = await pedir(destino, { cab: { Referer: FSHD_BASE + '/' } });
    const m = fp.status === 200 ? masterDoFsplay(fp.texto) : null;
    if (!m) continue;
    const origem = new URL(m.referer).origin;
    return {
      tipo: 'achou',
      link: { url: m.master, mime: MIME_HLS, referer: m.referer, headers: { Referer: m.referer, Origin: origem }, provider: 'fshd', option: 'FsPlay' },
    };
  }
  return { tipo: 'webview', motivo: 'sem-fsplay' };
}
