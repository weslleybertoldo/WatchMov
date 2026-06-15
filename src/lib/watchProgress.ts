import { WatchItem, Season } from '@/types/watch';

// Episódios assistidos de uma temporada. Compat: itens antigos só têm a contagem
// sequencial (watchedEpisodes), então deriva 1..N quando não há watchedList.
export function episodesWatched(s: Season): number[] {
  return s.watchedList ?? Array.from({ length: s.watchedEpisodes || 0 }, (_, i) => i + 1);
}

export function isEpisodeWatched(item: WatchItem | null | undefined, seasonNumber?: number, episode?: number): boolean {
  if (!item?.seasons || seasonNumber == null || episode == null) return false;
  const s = item.seasons.find(x => x.number === seasonNumber);
  return !!s && episodesWatched(s).includes(episode);
}

// Onde parou: maior episódio assistido na maior temporada com algum assistido.
export function lastStopped(item: WatchItem): { season: number; episode: number } | null {
  const withWatched = (item.seasons || []).filter(s => episodesWatched(s).length > 0);
  if (!withWatched.length) return null;
  const s = withWatched.reduce((a, b) => (b.number > a.number ? b : a));
  return { season: s.number, episode: Math.max(...episodesWatched(s)) };
}

// Legenda do card "Continuar assistindo" (séries): "Eps 5 | Temporada 4".
export function continueLabel(item: WatchItem): string | undefined {
  if (item.type !== 'series') return undefined;
  const ls = lastStopped(item);
  return ls ? `Eps ${ls.episode} | Temporada ${ls.season}` : undefined;
}
