import type { SniffResult } from '@/lib/streamSniffer';

// Por título/episódio guarda a LISTA cumulativa de links capturados + o último
// link aberto (chosenUrl) + a posição. Reabrir → abre o último link direto; a
// lista só cresce (novos links entram abaixo) e nunca se perde (TTL 12h).
const KEY = 'watchmov_streamcache';
const TTL_MS = 12 * 60 * 60 * 1000;

export interface StreamEntry {
  streams: SniffResult[];
  chosenUrl?: string;
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

// Adiciona links à lista (dedup por url; mantém os já salvos, novos entram no fim).
export function addStreams(list: SniffResult[], tmdbId?: number, type?: string, season?: number, episode?: number) {
  if (!list.length) return;
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k];
  const map = new Map<string, SniffResult>();
  (prev?.streams || []).forEach(s => map.set(s.url, s));
  list.forEach(s => { if (!map.has(s.url)) map.set(s.url, s); });
  d[k] = { streams: [...map.values()], chosenUrl: prev?.chosenUrl, positionMs: prev?.positionMs, ts: Date.now() };
  write(d);
}

// Marca o último link aberto (o que reabre automaticamente).
export function setChosen(url: string, tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k] || { streams: [], ts: Date.now() };
  d[k] = { ...prev, chosenUrl: url, ts: Date.now() };
  write(d);
}

export function setStreamPosition(positionMs: number, tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const e = d[k];
  if (e) { e.positionMs = positionMs; write(d); }
}
