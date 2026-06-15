// Integração com addons do Stremio (protocolo Addon SDK).
// Cada addon expõe GET {base}/stream/{type}/{id}.json e responde { streams: [...] }.
// - type: 'movie' | 'series'
// - id filme: imdbId (tt123). id série: imdbId:season:episode (tt123:1:1)
// Addons servem com CORS '*' (são consumidos pelo Stremio Web), então dá pra
// chamar direto do browser. Streams com `url` HTTP tocam no player in-app;
// streams de torrent (`infoHash`) NÃO tocam em browser/WebView — pra esses
// oferecemos abrir no app Stremio ou copiar o magnet.

const ADDONS_KEY = 'watchmov_stremio_addons';

// Addons padrão (torrent). Sem debrid configurado devolvem infoHash (não tocam
// in-app), mas servem pra listar e abrir no Stremio. O usuário pode colar a URL
// do addon dele (ex: Torrentio + RealDebrid) pra receber `url` HTTP que toca.
export const DEFAULT_ADDONS: StremioAddon[] = [
  // Config language=portuguese prioriza/inclui faixas PT-BR e dual áudio.
  { name: 'Torrentio PT', url: 'https://torrentio.strem.fun/language=portuguese%7Csort=qualitysize' },
];

export interface StremioAddon {
  name: string;
  url: string; // base, sem barra final e sem /manifest.json
}

export interface StremioStream {
  id: string;            // chave estável pra React
  addon: string;         // nome do addon de origem
  label: string;         // linha principal (name)
  detail: string;        // descrição (title/description) — filename, seeders, etc
  quality?: string;      // 2160p/1080p/720p…
  qualityRank: number;   // 4=4K/2160, 3=1080, 2=720, 1=outras, 0=sem info
  size?: string;         // ex "12.26 GB"
  dubbed: boolean;       // heurística PT/dual no texto
  url?: string;          // link HTTP direto (reproduzível in-app)
  notWebReady: boolean;  // behaviorHints.notWebReady (mkv etc — pode não tocar)
  infoHash?: string;     // torrent
  fileIdx?: number;
  filename?: string;
}

interface RawStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: { notWebReady?: boolean; filename?: string; bingeGroup?: string };
}

export interface StremioTarget {
  imdbId?: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

/** Normaliza a URL informada pelo usuário pra base do addon (remove /manifest.json e barra final). */
export function normalizeAddonUrl(raw: string): string {
  let u = raw.trim();
  u = u.replace(/\/manifest\.json.*$/i, '');
  u = u.replace(/\/+$/, '');
  return u;
}

/**
 * Monta a URL do addon Torrentio com RealDebrid → devolve links HTTP diretos
 * (resolve o "sem peers" do WebTorrent: o RD baixa o torrent e serve por HTTP).
 * Token em real-debrid.com/apitoken. Fica só no localStorage do usuário.
 */
export function buildTorrentioRealDebrid(token: string): StremioAddon {
  const t = token.trim();
  // preset 'brazuca' (foco PT-BR dublado) + realdebrid → links HTTP que tocam in-app.
  const opts = `brazuca|sort=qualitysize|realdebrid=${t}`;
  return { name: 'Torrentio BR+RD', url: `https://torrentio.strem.fun/${opts}` };
}

export function loadAddons(): StremioAddon[] {
  try {
    const raw = localStorage.getItem(ADDONS_KEY);
    if (!raw) return DEFAULT_ADDONS;
    const parsed = JSON.parse(raw) as StremioAddon[];
    return Array.isArray(parsed) ? parsed : DEFAULT_ADDONS;
  } catch {
    return DEFAULT_ADDONS;
  }
}

export function saveAddons(addons: StremioAddon[]): void {
  try { localStorage.setItem(ADDONS_KEY, JSON.stringify(addons)); } catch { /* ignore */ }
}

/** Monta o id do Stremio pro target. Requer imdbId. */
export function buildStremioId(t: StremioTarget): { type: 'movie' | 'series'; id: string } | null {
  if (!t.imdbId) return null;
  if (t.type === 'movie') return { type: 'movie', id: t.imdbId };
  return { type: 'series', id: `${t.imdbId}:${t.season ?? 1}:${t.episode ?? 1}` };
}

const QUALITY_RE = /(2160p|4k|1440p|1080p|720p|480p|360p)/i;
const SIZE_RE = /(\d+(?:[.,]\d+)?\s?(?:GB|MB))/i;
// Dublado/PT-BR (não conta "legendado" como dublado).
const DUB_RE = /\b(dual|dublado|dublada|portugu[eê]s|brazilian|nacional|dual[\s.-]?[aá]udio)\b|🇧🇷|🇵🇹|pt-?br/i;

/** Heurística: o release parece ter áudio dublado/PT-BR? (não considera "legendado"). */
export function detectDubbed(text: string): boolean {
  return DUB_RE.test(text || '');
}

function qualityRank(q?: string): number {
  if (!q) return 0;
  const s = q.toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return 4;
  if (s.includes('1080')) return 3;
  if (s.includes('720')) return 2;
  return 1;
}

/** Ordena: dublado primeiro, depois reproduzível in-app (url), depois maior qualidade. */
function sortStreams(a: StremioStream, b: StremioStream): number {
  const score = (s: StremioStream) => (s.dubbed ? 1000 : 0) + (s.url ? 400 : 0) + s.qualityRank * 10;
  return score(b) - score(a);
}

function normalizeStream(raw: RawStream, addonName: string, idx: number): StremioStream | null {
  const url = raw.url || raw.externalUrl;
  if (!url && !raw.infoHash) return null; // sem como reproduzir nem referenciar
  const label = (raw.name || addonName).trim();
  const detail = (raw.title || raw.description || '').trim();
  const haystack = `${label}\n${detail}\n${raw.behaviorHints?.filename ?? ''}`;
  const quality = haystack.match(QUALITY_RE)?.[1];
  const size = detail.match(SIZE_RE)?.[1];
  return {
    id: `${addonName}-${idx}-${raw.infoHash ?? url ?? ''}`.slice(0, 120),
    addon: addonName,
    label,
    detail,
    quality: quality?.toUpperCase(),
    qualityRank: qualityRank(quality),
    size,
    dubbed: detectDubbed(haystack),
    url: url || undefined,
    notWebReady: !!raw.behaviorHints?.notWebReady,
    infoHash: raw.infoHash,
    fileIdx: raw.fileIdx,
    filename: raw.behaviorHints?.filename,
  };
}

async function fetchAddonStreams(addon: StremioAddon, st: { type: string; id: string }): Promise<StremioStream[]> {
  const base = normalizeAddonUrl(addon.url);
  const endpoint = `${base}/stream/${st.type}/${encodeURIComponent(st.id)}.json`;
  const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${addon.name}: HTTP ${res.status}`);
  const json = (await res.json()) as { streams?: RawStream[] };
  const streams = json.streams || [];
  return streams
    .map((s, i) => normalizeStream(s, addon.name, i))
    .filter((s): s is StremioStream => s !== null);
}

export interface FetchStreamsResult {
  streams: StremioStream[];
  errors: string[];
}

/** Busca streams de todos os addons em paralelo e agrega (erros isolados por addon). */
export async function fetchStreams(addons: StremioAddon[], target: StremioTarget): Promise<FetchStreamsResult> {
  const st = buildStremioId(target);
  if (!st) return { streams: [], errors: ['Sem IMDB ID — Stremio precisa do código IMDB do título.'] };

  const results = await Promise.allSettled(addons.map(a => fetchAddonStreams(a, st)));
  const streams: StremioStream[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') streams.push(...r.value);
    else errors.push(`${addons[i].name}: ${r.reason instanceof Error ? r.reason.message : 'falhou'}`);
  });
  streams.sort(sortStreams);
  return { streams, errors };
}

// ---- Legendas (recurso `subtitles` do Stremio Addon SDK) ----
// GET {base}/subtitles/{type}/{id}.json → { subtitles: [{ id, url, lang }] }.
const SUBTITLE_ADDONS = ['https://opensubtitles-v3.strem.io'];
const PT_LANGS = /(pob|por|^pt|pt-?br|portugu)/i;

export interface StremioSubtitle {
  id: string;
  lang: string;
  label: string;
  url: string;   // .srt (convertido pra VTT na hora de usar)
}

function ptLabel(lang: string): string {
  if (/pob|pt-?br/i.test(lang)) return 'Português (BR)';
  if (/por|^pt/i.test(lang)) return 'Português (PT)';
  return lang || 'Legenda';
}

/** Busca legendas (por padrão só PT-BR/PT) dos addons de legenda. Erros isolados por addon. */
export async function fetchSubtitles(target: StremioTarget, onlyPt = true): Promise<StremioSubtitle[]> {
  const st = buildStremioId(target);
  if (!st) return [];
  const out: StremioSubtitle[] = [];
  await Promise.allSettled(SUBTITLE_ADDONS.map(async (base) => {
    const ep = `${normalizeAddonUrl(base)}/subtitles/${st.type}/${encodeURIComponent(st.id)}.json`;
    const res = await fetch(ep, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const json = (await res.json()) as { subtitles?: { id?: string; url: string; lang: string }[] };
    (json.subtitles || []).forEach((s, i) => {
      if (!s.url) return;
      if (onlyPt && !PT_LANGS.test(s.lang || '')) return;
      out.push({ id: s.id || `${s.lang}-${i}`, lang: s.lang, label: ptLabel(s.lang), url: s.url });
    });
  }));
  const seen = new Set<string>();
  return out.filter(s => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

/** Converte texto SRT em WebVTT (header + timestamps com '.' no lugar de ','). Função pura. */
export function srtToVtt(srt: string): string {
  const body = srt.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return /^WEBVTT/.test(body) ? body : `WEBVTT\n\n${body}`;
}

/** Baixa um .srt e devolve um blob URL WebVTT (o <track> exige VTT + CORS/same-origin). */
export async function srtUrlToVttBlob(srtUrl: string): Promise<string> {
  const res = await fetch(srtUrl);
  if (!res.ok) throw new Error(`legenda HTTP ${res.status}`);
  const vtt = srtToVtt(await res.text());
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}

const TRACKERS = [
  // WSS primeiro — são os que o WebTorrent (browser) consegue usar pra achar peers.
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
];

/** Magnet a partir do infoHash (pra copiar ou abrir num cliente de torrent). */
export function buildMagnet(s: StremioStream): string {
  const dn = encodeURIComponent(s.filename || s.label);
  const tr = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${s.infoHash}&dn=${dn}${tr}`;
}

/** Deep link pra abrir a página de detalhe no app Stremio (lista os streams lá). */
export function buildStremioDeepLink(t: StremioTarget): string | null {
  const st = buildStremioId(t);
  if (!st) return null;
  // web.stremio.com abre tanto no app quanto no navegador
  return `https://web.stremio.com/#/detail/${st.type}/${t.imdbId}/${encodeURIComponent(st.id)}`;
}
