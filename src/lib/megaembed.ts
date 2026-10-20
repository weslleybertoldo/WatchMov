import { CapacitorHttp, Capacitor } from '@capacitor/core';
import type { SniffResult } from './streamSniffer';

// Fonte 7 (MegaEmbed) por HTTP (20/10/2026, estudo do Nuvio; pedido dele "1 e 3" → "1": entram TODAS as opções que
// abrirem, da melhor pra pior qualidade, inclusive os links de painel de IPTV). A página do embed já traz a lista
// escrita (`sources = [{file, type, label}]`); o app confere cada opção (HLS: o master responde #EXTM3U; MP4: o servidor
// responde vídeo) e ordena pela resolução (HLS: RESOLUTION do master; MP4: caixa `tkhd` do começo do arquivo). As
// opções mudam a cada pedido e os links de IPTV/streamtape caem a qualquer hora: o que não abre fica de fora.

export const MEGA_BASE = 'https://megaembed.com';
export const MEGA_REFERER = MEGA_BASE + '/';
export const MEGA_TIMEOUT_MS = 10000;   // por pedido
export const MEGA_PRAZO_MS = 25000;     // a cadeia inteira (quem chama cai no WebView depois disso)
export const MEGA_BYTES_MP4 = 65535;    // começo do MP4 lido pra achar a resolução (só com Accept-Ranges: bytes)
export const MIME_HLS = 'application/vnd.apple.mpegurl';
export const MIME_MP4 = 'video/mp4';

export interface OpcaoMega { file: string; type: string; label: string }
export interface Dimensoes { w: number; h: number }
export interface AlvoMega { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number }

export type MegaResultado =
  | { tipo: 'achou'; links: SniffResult[] }
  | { tipo: 'nao-tem'; motivo: string }
  | { tipo: 'webview'; motivo: string };

export function urlMegaEmbed(t: AlvoMega): string {
  return t.type === 'movie'
    ? `${MEGA_BASE}/embed/${t.tmdbId}`
    : `${MEGA_BASE}/embed/${t.tmdbId}/${t.season ?? 1}/${t.episode ?? 1}`;
}

// ── leitura (puras) ─────────────────────────────────────────────────────────────────────────────────────────────

// `sources = [...]` da página. Sem a lista = a página mudou de formato → null (quem chama cai no WebView);
// lista vazia = o MegaEmbed não tem o título.
export function opcoesDaPagina(html: string): OpcaoMega[] | null {
  const m = html.match(/\bsources\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return null;
  let arr: unknown;
  try { arr = JSON.parse(m[1]); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const vistas = new Set<string>();
  const out: OpcaoMega[] = [];
  for (const o of arr as Array<Record<string, unknown>>) {
    const file = typeof o?.file === 'string' ? o.file.trim() : '';
    if (!/^https?:\/\//i.test(file) || vistas.has(file)) continue;   // a mesma opção às vezes vem 2× com outro número
    vistas.add(file);
    out.push({ file, type: String(o.type ?? '').toLowerCase(), label: String(o.label ?? '').trim() || `Opção ${out.length + 1}` });
  }
  return out;
}

// "Acesso Restrito · Domínio Não Autorizado" (visto 20/10/2026 em ids que o MegaEmbed usa pra canal de TV): a página não
// toca fora do site deles, nem no WebView → conta como "não tem".
export function paginaRestrita(html: string): boolean {
  return /Dom[ií]nio N[ãa]o Autorizado|Acesso Restrito/i.test(html);
}

// Maior RESOLUTION do master (pela área, pra 1920×804 ganhar de 1280×720). Lista de pedaços sem variantes = null.
export function resolucaoDoMaster(texto: string): Dimensoes | null {
  let best: Dimensoes | null = null;
  for (const m of texto.matchAll(/RESOLUTION=(\d{2,5})x(\d{2,5})/g)) {
    const d = { w: Number(m[1]), h: Number(m[2]) };
    if (!best || d.w * d.h > best.w * best.h) best = d;
  }
  return best;
}

// Caixa `tkhd` (cabeçalho da faixa) do começo do MP4: largura e altura vêm em ponto fixo 16.16 nos 8 últimos bytes. A de
// áudio vem 0×0; vale a 1ª com imagem. MP4 sem o `moov` no começo (não "faststart") = null.
export function dimensoesDoMp4(b: Uint8Array): Dimensoes | null {
  const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  for (let i = 4; i + 4 <= b.length; i++) {
    if (b[i] !== 0x74 || b[i + 1] !== 0x6b || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue;   // "tkhd"
    const ini = i - 4, tam = u32(ini);
    if ((tam !== 92 && tam !== 104) || ini + tam > b.length) continue;   // versão 0 (92 B) ou 1 (104 B)
    const w = u32(ini + tam - 8) >>> 16, h = u32(ini + tam - 4) >>> 16;
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}

export function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Rótulo igual ao do resto do app (altura + "p", como o nativo mede).
export const rotuloDe = (d: Dimensoes | null) => (d ? `${d.h}p` : '');

// Mais pixels primeiro; sem resolução conhecida vai pro fim; empate = ordem da página.
export function ordenarPorQualidade<T extends { dim: Dimensoes | null; i: number }>(xs: T[]): T[] {
  const area = (d: Dimensoes | null) => (d ? d.w * d.h : 0);
  return [...xs].sort((a, b) => area(b.dim) - area(a.dim) || a.i - b.i);
}

// ── rede ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Resposta { status: number; data: unknown; headers: Record<string, string> }

const CAB_MEGA = { Referer: MEGA_REFERER, Origin: MEGA_BASE };

async function pedir(url: string, opts: { method?: 'GET' | 'HEAD'; cab?: Record<string, string>; binario?: boolean } = {}): Promise<Resposta> {
  const res = await CapacitorHttp.request({
    url, method: opts.method ?? 'GET', headers: { 'User-Agent': navigator.userAgent, ...(opts.cab ?? {}) },
    responseType: opts.binario ? 'arraybuffer' : 'text', connectTimeout: MEGA_TIMEOUT_MS, readTimeout: MEGA_TIMEOUT_MS,
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers ?? {})) headers[k.toLowerCase()] = String(v);
  return { status: res.status, data: res.data, headers };
}

const texto = (d: unknown) => (typeof d === 'string' ? d : '');

// Uma opção abre? HLS: o master responde #EXTM3U (e diz a resolução). MP4: o HEAD responde vídeo — streamtape devolve
// uma página de erro (text/html) e fica de fora; com Accept-Ranges lê só o começo pra achar a resolução (sem o Range o
// servidor mandaria o arquivo inteiro).
export async function conferirOpcao(o: OpcaoMega): Promise<{ abre: boolean; dim: Dimensoes | null; hls: boolean }> {
  const hls = o.type === 'hls' || /\.m3u8(\?|$)/i.test(o.file);
  try {
    if (hls) {
      const r = await pedir(o.file, { cab: CAB_MEGA });
      const t = texto(r.data);
      return { abre: r.status >= 200 && r.status < 300 && t.includes('#EXTM3U'), dim: resolucaoDoMaster(t), hls };
    }
    const h = await pedir(o.file, { method: 'HEAD', cab: CAB_MEGA });
    const ct = h.headers['content-type'] ?? '';
    if (h.status < 200 || h.status >= 300 || !/^video\/|octet-stream/i.test(ct)) return { abre: false, dim: null, hls };
    if (!/bytes/i.test(h.headers['accept-ranges'] ?? '')) return { abre: true, dim: null, hls };
    const r = await pedir(o.file, { cab: { ...CAB_MEGA, Range: `bytes=0-${MEGA_BYTES_MP4}` }, binario: true });
    const b64 = texto(r.data);
    return { abre: true, dim: r.status === 206 && b64 ? dimensoesDoMp4(base64ParaBytes(b64)) : null, hls };
  } catch {
    return { abre: false, dim: null, hls };
  }
}

// Fonte 7 por HTTP. `sinal.cancelado` (fechou o título / trocou a fonte) para a cadeia no próximo passo.
export async function resolverMegaEmbed(alvo: AlvoMega, sinal: { cancelado: boolean } = { cancelado: false }): Promise<MegaResultado> {
  if (!Capacitor.isNativePlatform()) return { tipo: 'webview', motivo: 'sem-nativo' };   // no navegador o CORS barra
  const pagina = await pedir(urlMegaEmbed(alvo), { cab: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  if (pagina.status === 404) return { tipo: 'nao-tem', motivo: 'f7-404' };
  if (pagina.status !== 200) return { tipo: 'webview', motivo: `pagina-${pagina.status}` };
  const html = texto(pagina.data);
  const opcoes = opcoesDaPagina(html);
  if (!opcoes) return paginaRestrita(html) ? { tipo: 'nao-tem', motivo: 'f7-restrito' } : { tipo: 'webview', motivo: 'sem-lista' };
  if (!opcoes.length) return { tipo: 'nao-tem', motivo: 'f7-sem-opcao' };
  if (sinal.cancelado) return { tipo: 'webview', motivo: 'cancelado' };

  const conferidas = await Promise.all(opcoes.map(async (o, i) => ({ o, i, ...(await conferirOpcao(o)) })));
  if (sinal.cancelado) return { tipo: 'webview', motivo: 'cancelado' };
  const abertas = ordenarPorQualidade(conferidas.filter(c => c.abre));
  if (!abertas.length) return { tipo: 'nao-tem', motivo: `f7-nenhuma-abriu n=${opcoes.length}` };
  return {
    tipo: 'achou',
    links: abertas.map(c => ({
      url: c.o.file, mime: c.hls ? MIME_HLS : MIME_MP4, referer: MEGA_REFERER, headers: { ...CAB_MEGA },
      quality: rotuloDe(c.dim) || undefined, provider: 'megaembed', option: c.o.label,
    })),
  };
}
