import { useEffect, useReducer } from 'react';

// Registro de "baixados" (WIP). Hoje só marca o estado em localStorage — o
// salvamento real do arquivo de vídeo (captura do stream m3u8/mp4) é a etapa
// nativa seguinte. Estrutura pensada pra migrar pro backend depois.
const KEY = 'watchmov_downloads';
const listeners = new Set<() => void>();

function read(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(KEY) || '[]')); }
  catch { return new Set<string>(); }
}
function write(s: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...s]));
  listeners.forEach(l => l());
}

export const movieKey = (tmdbId: number) => `m:${tmdbId}`;
export const epKey = (tmdbId: number, season: number, ep: number) => `e:${tmdbId}:${season}:${ep}`;

export function getDownloads(): Set<string> { return read(); }
export function isDownloaded(key: string): boolean { return read().has(key); }

export function setDownloaded(keys: string[], value: boolean) {
  const s = read();
  keys.forEach(k => (value ? s.add(k) : s.delete(k)));
  write(s);
}

// Há algo baixado (filme ou qualquer episódio) para este tmdbId?
export function hasAnyDownload(set: Set<string>, tmdbId: number, isMovie: boolean): boolean {
  if (isMovie) return set.has(movieKey(tmdbId));
  const prefix = `e:${tmdbId}:`;
  for (const k of set) if (k.startsWith(prefix)) return true;
  return false;
}

// Episódios baixados de um título (parseia as chaves e:{tmdbId}:{s}:{e}).
export function downloadedEpisodesOf(set: Set<string>, tmdbId: number): { season: number; ep: number }[] {
  const p = `e:${tmdbId}:`;
  const out: { season: number; ep: number }[] = [];
  for (const k of set) if (k.startsWith(p)) {
    const parts = k.split(':');
    out.push({ season: Number(parts[2]), ep: Number(parts[3]) });
  }
  return out.sort((a, b) => a.season - b.season || a.ep - b.ep);
}

// Remove todos os downloads de um título (filme inteiro ou todos os eps da série).
export function clearDownloadsFor(tmdbId: number, isMovie: boolean) {
  const s = read();
  if (isMovie) { s.delete(movieKey(tmdbId)); }
  else { const p = `e:${tmdbId}:`; for (const k of [...s]) if (k.startsWith(p)) s.delete(k); }
  write(s);
}

// Hook reativo: re-renderiza quando o conjunto de baixados muda.
export function useDownloads(): Set<string> {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return read();
}
