export function formatTime(minutes: number): string {
  if (minutes <= 0) return '0min';
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Data invalida';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Quantidade de avaliações compacta PT-BR: 4000 -> "4 mil", 1_500_000 -> "1,5 mi"
export function formatVotes(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number(v.toFixed(1)).toString().replace('.', ',')} mi`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)} mil`;
  return String(n);
}

// Nota + avaliações: rating 8 / votes 4000 -> "8/10 - 4 mil"; sem votos -> "8/10"
export function formatRating(rating?: number, votes?: number): string | null {
  if (rating === undefined || rating === null || rating <= 0) return null;
  const nota = `${Number(rating.toFixed(1))}/10`;
  return votes && votes > 0 ? `${nota} - ${formatVotes(votes)}` : nota;
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
