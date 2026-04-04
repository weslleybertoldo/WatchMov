export function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function getSeriesProgress(seasons: { watchedEpisodes: number; totalEpisodes: number }[]): number {
  const total = seasons.reduce((a, s) => a + s.totalEpisodes, 0);
  const watched = seasons.reduce((a, s) => a + s.watchedEpisodes, 0);
  if (total === 0) return 0;
  return (watched / total) * 100;
}

export function getSeasonProgress(season: { watchedEpisodes: number; totalEpisodes: number }): number {
  if (season.totalEpisodes === 0) return 0;
  return (season.watchedEpisodes / season.totalEpisodes) * 100;
}
