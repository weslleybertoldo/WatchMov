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
  durationMs?: number;             // duração REAL do arquivo (do player), p/ a barra
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
    if (idx >= 0) arr[idx] = { url: s.url, mime: s.mime || arr[idx].mime, referer: s.referer || arr[idx].referer, quality: s.quality || arr[idx].quality, headers: s.headers || arr[idx].headers };
    else arr.push(s);
  }
  // PRESERVA durationMs: é a duração REAL medida pelo player. Sem isso, capturar um
  // link novo apagava a duração e a barra/tempo ("22:55 / 1:40:15") sumia.
  d[k] = { streams: arr, chosenUrl: prev?.chosenUrl, lastMode: prev?.lastMode,
           positionMs: prev?.positionMs, durationMs: prev?.durationMs, ts: Date.now() };
  write(d);
}

// Remove um link da lista (ex.: expirou/falhou ao tocar). Compara por streamKey
// (ignora o token). Se era o chosenUrl, limpa. Mantém a lista só com links bons.
export function removeStream(url: string, tmdbId?: number, type?: string, season?: number, episode?: number) {
  if (!url) return;
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const e = d[k];
  if (!e) return;
  const key = streamKey(url);
  const arr = e.streams.filter(s => streamKey(s.url) !== key);
  if (arr.length === e.streams.length) return; // não tinha esse link
  e.streams = arr;
  if (e.chosenUrl && streamKey(e.chosenUrl) === key) e.chosenUrl = undefined;
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

// Última posição salva de um título (o episódio mais recente, no caso de série):
// usado no card "Continuar assistindo" pra mostrar o progresso do EP atual.
export function latestPosition(tmdbId?: number): { season: number; episode: number; positionMs: number; durationMs?: number } | null {
  if (tmdbId == null) return null;
  const d = read();
  let best: { season: number; episode: number; positionMs: number; durationMs?: number; ts: number } | null = null;
  for (const [k, e] of Object.entries(d)) {
    const [tid, , s, ep] = k.split(':');
    if (tid !== String(tmdbId) || !e.positionMs) continue;   // posição não expira (só os links)
    if (!best || e.ts > best.ts) best = { season: Number(s), episode: Number(ep), positionMs: e.positionMs, durationMs: e.durationMs, ts: e.ts };
  }
  return best ? { season: best.season, episode: best.episode, positionMs: best.positionMs, durationMs: best.durationMs } : null;
}

// Posição SEM TTL: o link expira em 12h, mas "onde parei" não pode sumir (o
// vídeo baixado continua lá). Fonte única lida pela home e pela aba Download.
export function getPosition(tmdbId?: number, type?: string, season?: number, episode?: number): { positionMs: number; durationMs?: number } | null {
  const e = read()[keyFor(tmdbId, type, season, episode)];
  if (!e?.positionMs) return null;
  return { positionMs: e.positionMs, durationMs: e.durationMs };
}

export function setStreamPosition(positionMs: number, tmdbId?: number, type?: string, season?: number, episode?: number, durationMs?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  // CRIA a entrada se ainda não existe: assistir pela aba Download (que não passa
  // pela captura/addStreams) precisa salvar o progresso do mesmo jeito, senão o
  // "Continuar assistindo" não reflete o que foi visto ali.
  if (!d[k]) d[k] = { streams: [], ts: Date.now() };
  const e = d[k];
  e.ts = Date.now();          // renova: enquanto assiste, a entrada não expira
  if (e) { e.positionMs = positionMs; if (durationMs && durationMs > 0) e.durationMs = durationMs; write(d); }
}
