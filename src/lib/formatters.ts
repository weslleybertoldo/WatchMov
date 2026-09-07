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

// Data em que um episódio FUTURO vai ao ar, curta pro card: "12/09" no ano corrente,
// "05/01/27" em outro ano. Entrada YYYY-MM-DD (TMDB); inválida -> "".
export function formatAirDate(date?: string, today: Date = new Date()): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [y, m, d] = date.split('-');
  return Number(y) === today.getFullYear() ? `${d}/${m}` : `${d}/${m}/${y.slice(2)}`;
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

// Tag de título/episódio que ainda não saiu: "Em breve 12/09" (data da TMDB no formato
// do formatAirDate; sem data válida fica só "Em breve"). Pedido do Weslley 07/09/2026.
export function upcomingLabel(date?: string, today: Date = new Date()): string {
  const d = formatAirDate(date, today);
  return d ? `Em breve ${d}` : 'Em breve';
}
