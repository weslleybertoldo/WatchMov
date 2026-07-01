import type { SniffResult } from '@/lib/streamSniffer';

// Cache da URL capturada por título/episódio. As URLs têm token que expira, então
// guardamos com timestamp e só reusamos por um tempo (TTL); se o player falhar, o
// chamador invalida e recaptura.
const KEY = 'watchmov_streamcache';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface Entry extends SniffResult { ts: number }

function read(): Record<string, Entry> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function write(data: Record<string, Entry>) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

function keyFor(tmdbId?: number, type?: string, season?: number, episode?: number): string {
  return `${tmdbId ?? 0}:${type ?? 'movie'}:${season ?? 0}:${episode ?? 0}`;
}

export function getCachedStream(tmdbId?: number, type?: string, season?: number, episode?: number): SniffResult | null {
  const e = read()[keyFor(tmdbId, type, season, episode)];
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) return null;
  return { url: e.url, mime: e.mime, referer: e.referer };
}

export function setCachedStream(r: SniffResult, tmdbId?: number, type?: string, season?: number, episode?: number) {
  const data = read();
  data[keyFor(tmdbId, type, season, episode)] = { ...r, ts: Date.now() };
  write(data);
}

export function invalidateStream(tmdbId?: number, type?: string, season?: number, episode?: number) {
  const data = read();
  delete data[keyFor(tmdbId, type, season, episode)];
  write(data);
}
