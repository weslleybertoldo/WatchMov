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
  let posMs = 0, durMs = 0;
  if (latest && latest.positionMs > 0) {
    posMs = latest.positionMs;
    durMs = latest.durationMs && latest.durationMs > 0 ? latest.durationMs : 0;
    // Filme sem duração real: usa totalDuration do TMDB (é preciso p/ filme).
    // Série: NÃO usa episodeDuration (é média genérica errada, ex. 24 num ep de 46) —
    // mostra só o tempo decorrido até o player salvar a duração REAL do arquivo.
    if (!durMs && item.type === 'movie' && (item.totalDuration || 0) > 0) durMs = (item.totalDuration as number) * 60000;
  } else if (item.type === 'movie' && (item.watchedDuration || 0) > 0 && (item.totalDuration || 0) > 0) {
    // Filme sem entrada no streamCache: usa o progresso do store (minutos).
    posMs = (item.watchedDuration as number) * 60000;
    durMs = (item.totalDuration as number) * 60000;
  }
  if (!posMs) return null;
  if (durMs > 0) return { pct: Math.min(1, posMs / durMs), label: `${fmtClock(posMs)} / ${fmtClock(durMs)}` };
  return { pct: 0, label: fmtClock(posMs) }; // sem duração alguma: só o tempo decorrido
}

// Legenda do card "Continuar assistindo" (séries): "EP 5/12 | Temporada 4".
// Usa o episódio EM ANDAMENTO (streamCache), não só o marcado como assistido —
// assim aparece já ao começar a assistir. Fallback = último ep marcado.
export function continueLabel(item: WatchItem): string | undefined {
  if (item.type !== 'series') return undefined;
  const latest = latestPosition(item.tmdbId);
  const ls = lastStopped(item);
  const season = latest ? latest.season : ls?.season;
  const episode = latest ? latest.episode : ls?.episode;
  if (season == null || episode == null) return undefined;
  const s = (item.seasons || []).find(x => x.number === season);
  const total = s?.totalEpisodes;
  return `EP ${episode}${total ? `/${total}` : ''} | Temporada ${season}`;
}
