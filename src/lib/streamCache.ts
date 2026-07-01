import type { SniffResult } from '@/lib/streamSniffer';

// Por título/episódio guarda a LISTA cumulativa de links capturados + o último
// link aberto (chosenUrl) + a posição. Reabrir → abre o último link direto; a
// lista só cresce (novos links entram abaixo) e nunca se perde (TTL 12h).
const KEY = 'watchmov_streamcache';
const TTL_MS = 12 * 60 * 60 * 1000;

export interface StreamEntry {
  streams: SniffResult[];
  chosenUrl?: string;
  lastMode?: 'native' | 'server';  // como assistiu por último (reabre igual)
  positionMs?: number;
  ts: number;
}

function read(): Record<string, StreamEntry> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function write(d: Record<string, StreamEntry>) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
}
function keyFor(tmdbId?: number, type?: string, season?: number, episode?: number): string {
  return `${tmdbId ?? 0}:${type ?? 'movie'}:${season ?? 0}:${episode ?? 0}`;
}

export function getEntry(tmdbId?: number, type?: string, season?: number, episode?: number): StreamEntry | null {
  const e = read()[keyFor(tmdbId, type, season, episode)];
  if (!e || Date.now() - e.ts > TTL_MS) return null;
  return e;
}

// Chave estável do stream: URL sem a query (o token muda a cada captura, mas o
// caminho é o mesmo) → o mesmo vídeo não duplica.
export function streamKey(url: string): string { return url.split('?')[0]; }

// Tenta extrair a resolução da URL (ex "720p", "1280x720", "/1080/"). Heurística —
// a resolução exata do HLS adaptativo vem do player (track selection).
export function qualityFromUrl(url: string): string {
  const p = url.split('?')[0].toLowerCase();
  let m = p.match(/(\d{3,4})p(?:[^0-9]|$)/);
  if (m) return m[1] + 'p';
  m = p.match(/\d{3,4}x(\d{3,4})/);
  if (m) return m[1] + 'p';
  m = p.match(/[/_-](240|360|480|540|576|720|1080|1440|2160)[/_.-]/);
  if (m) return m[1] + 'p';
  return '';
}

// Adiciona links (dedup por streamKey; se já existe, atualiza o token/URL fresca;
// só entra novo se for um vídeo diferente).
export function addStreams(list: SniffResult[], tmdbId?: number, type?: string, season?: number, episode?: number) {
  if (!list.length) return;
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k];
  const arr: SniffResult[] = [...(prev?.streams || [])];
  for (const s of list) {
    const key = streamKey(s.url);
    const idx = arr.findIndex(x => streamKey(x.url) === key);
    if (idx >= 0) arr[idx] = { url: s.url, mime: s.mime || arr[idx].mime, referer: s.referer || arr[idx].referer };
    else arr.push(s);
  }
  d[k] = { streams: arr, chosenUrl: prev?.chosenUrl, lastMode: prev?.lastMode, positionMs: prev?.positionMs, ts: Date.now() };
  write(d);
}

// Assistiu por link (reprodutor) → reabre no reprodutor nesse link.
export function setChosen(url: string, tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k] || { streams: [], ts: Date.now() };
  d[k] = { ...prev, chosenUrl: url, lastMode: 'native', ts: Date.now() };
  write(d);
}

// Assistiu pelo servidor → reabre no servidor (não no reprodutor).
export function setServerMode(tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k] || { streams: [], ts: Date.now() };
  d[k] = { ...prev, lastMode: 'server', ts: Date.now() };
  write(d);
}

export function setStreamPosition(positionMs: number, tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const e = d[k];
  if (e) { e.positionMs = positionMs; write(d); }
}
