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

// Total de episódios marcados como assistidos no item (todas as temporadas).
export function totalEpisodesWatched(item: WatchItem): number {
  return (item.seasons || []).reduce((sum, s) => sum + episodesWatched(s).length, 0);
}

// Formata minutos → "45min" ou "1h20".
function fmtMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

// Progresso do "Continuar assistindo": tempo visto + fração pra barra. Usa o que já
// está salvo (filme: watchedDuration/totalDuration; série: minutos dos eps assistidos
// + parcial da temporada). Retorna null quando não há nada assistido.
export function continueProgress(item: WatchItem): { pct: number; label: string } | null {
  if (item.type === 'movie') {
    const total = item.totalDuration || 0;
    const watched = total > 0 ? Math.min(item.watchedDuration || 0, total) : (item.watchedDuration || 0);
    if (!watched) return null;
    const pct = total > 0 ? Math.min(1, watched / total) : 0;
    return { pct, label: fmtMin(watched) + (total > 0 ? ` / ${fmtMin(total)}` : '') };
  }
  const seasons = item.seasons || [];
  let watchedMin = 0, totalMin = 0, watchedEps = 0, totalEps = 0;
  for (const s of seasons) {
    const dur = s.episodeDuration || 0;
    const eps = episodesWatched(s).length;
    watchedMin += eps * dur + (s.partialEpisodeTime || 0);
    totalMin += (s.totalEpisodes || 0) * dur;
    watchedEps += eps;
    totalEps += s.totalEpisodes || 0;
  }
  if (!watchedEps && !watchedMin) return null;
  if (totalMin > 0) return { pct: Math.min(1, watchedMin / totalMin), label: fmtMin(watchedMin) + ` / ${fmtMin(totalMin)}` };
  // sem duração salva: cai pra fração de episódios
  const pct = totalEps > 0 ? Math.min(1, watchedEps / totalEps) : 0;
  return { pct, label: `${watchedEps}${totalEps ? `/${totalEps}` : ''} eps` };
}

// Legenda do card "Continuar assistindo" (séries): "Eps 5 | Temporada 4".
export function continueLabel(item: WatchItem): string | undefined {
  if (item.type !== 'series') return undefined;
  const ls = lastStopped(item);
  return ls ? `Eps ${ls.episode} | Temporada ${ls.season}` : undefined;
}
