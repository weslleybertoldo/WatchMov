import { useState } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaRow from './MediaRow';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

type HistFilter = 'movie' | 'series' | 'anime';

interface HistoryViewProps {
  movies: MediaSummary[];
  series: MediaSummary[];
  animes: MediaSummary[];
  onOpen: (media: MediaSummary) => void;
  onBack: () => void;
}

const TITLES: Record<HistFilter, string> = { movie: 'Filmes', series: 'Séries', anime: 'Animes' };

export default function HistoryView({ movies, series, animes, onOpen, onBack }: HistoryViewProps) {
  const [filter, setFilter] = useState<HistFilter | null>(null);
  const empty = movies.length === 0 && series.length === 0 && animes.length === 0;

  if (filter) {
    const list = filter === 'movie' ? movies : filter === 'anime' ? animes : series;
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFilter(null)}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-bold">{TITLES[filter]} assistidos</h1>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {list.map(m => <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} onClick={() => onOpen(m)} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold">Histórico</h1>
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nada assistido ainda. Marque um filme como assistido ou um episódio de série/anime.</p>
      ) : (
        <>
          {movies.length > 0 && <MediaRow title="Filmes" items={movies} onOpen={onOpen} onSeeAll={() => setFilter('movie')} />}
          {series.length > 0 && <MediaRow title="Séries" items={series} onOpen={onOpen} onSeeAll={() => setFilter('series')} />}
          {animes.length > 0 && <MediaRow title="Animes" items={animes} onOpen={onOpen} onSeeAll={() => setFilter('anime')} />}
        </>
      )}
    </div>
  );
}
