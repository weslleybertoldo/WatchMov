import { WatchItem, Season } from '@/types/watch';
import { latestPosition } from '@/lib/streamCache';

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

// Tempo → relógio: "9:54" ou "1:46:05".
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// Progresso do "Continuar assistindo": barra + tempo (posição / duração) do episódio
// ou filme atual. Usa posição/duração REAIS do player (streamCache); filme sem
// streamCache cai pro store. Retorna null (sem barra) quando não há posição confiável.
export function continueProgress(item: WatchItem): { pct: number; label: string } | null {
  const latest = latestPosition(item.tmdbId);
  if (latest && latest.positionMs > 0) {
    // Duração REAL do player; se ainda não foi salva (jogado em versão antiga),
    // cai pro episodeDuration da temporada (aprox., corrige ao reproduzir na v3.02+).
    let durMs = latest.durationMs && latest.durationMs > 0 ? latest.durationMs : 0;
    if (!durMs && item.type === 'series') {
      const s = (item.seasons || []).find(x => x.number === latest.season);
      if (s?.episodeDuration) durMs = s.episodeDuration * 60000;
    }
    if (durMs > 0) return { pct: Math.min(1, latest.positionMs / durMs), label: `${fmtClock(latest.positionMs)} / ${fmtClock(durMs)}` };
    return { pct: 0, label: fmtClock(latest.positionMs) }; // sem duração: só o tempo decorrido
  }
  // Filme sem posição no streamCache: usa watchedDuration/totalDuration (minutos).
  if (item.type === 'movie') {
    const total = (item.totalDuration || 0) * 60000, watched = (item.watchedDuration || 0) * 60000;
    if (watched > 0 && total > 0) return { pct: Math.min(1, watched / total), label: `${fmtClock(watched)} / ${fmtClock(total)}` };
  }
  return null;
}

// Legenda do card "Continuar assistindo" (séries): "EP 5/12 | Temporada 4".
export function continueLabel(item: WatchItem): string | undefined {
  if (item.type !== 'series') return undefined;
  const ls = lastStopped(item);
  if (!ls) return undefined;
  const s = (item.seasons || []).find(x => x.number === ls.season);
  const total = s?.totalEpisodes;
  return `EP ${ls.episode}${total ? `/${total}` : ''} | Temporada ${ls.season}`;
}
