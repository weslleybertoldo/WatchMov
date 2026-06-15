import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  MediaSummary, discoverFilter, type BrowseKind,
  MOVIE_GENRES, TV_GENRES, ANIME_GENRES, BROWSE_YEARS, BROWSE_RATINGS,
} from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { Film, Tv, Sparkles, Loader2 } from 'lucide-react';

interface BrowseViewProps {
  onOpen: (media: MediaSummary) => void;
}

const KINDS: { key: BrowseKind; label: string; icon: typeof Film }[] = [
  { key: 'movie', label: 'Filmes', icon: Film },
  { key: 'tv', label: 'Séries', icon: Tv },
  { key: 'anime', label: 'Animes', icon: Sparkles },
];

function genresFor(kind: BrowseKind) {
  return kind === 'movie' ? MOVIE_GENRES : kind === 'tv' ? TV_GENRES : ANIME_GENRES;
}

const selectCls =
  'h-9 rounded-lg bg-muted/60 border border-border px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export default function BrowseView({ onOpen }: BrowseViewProps) {
  const [kind, setKind] = useState<BrowseKind>('movie');
  const [genreId, setGenreId] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);

  const [items, setItems] = useState<MediaSummary[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const genres = useMemo(() => genresFor(kind), [kind]);

  const load = useCallback(async (p: number, reset: boolean) => {
    setLoading(true);
    try {
      const res = await discoverFilter({ kind, genreId, year, minRating, page: p });
      setItems(prev => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map(i => `${i.type}-${i.tmdbId}`));
        return [...base, ...res.filter(i => !seen.has(`${i.type}-${i.tmdbId}`))];
      });
      setDone(res.length === 0);
    } catch {
      if (reset) setItems([]);
      setDone(true);
    } finally {
      setLoading(false);
    }
  }, [kind, genreId, year, minRating]);

  // Recarrega do zero sempre que tipo/filtros mudam.
  useEffect(() => {
    setPage(1);
    setDone(false);
    load(1, true);
  }, [load]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next, false);
  };

  const changeKind = (k: BrowseKind) => {
    if (k === kind) return;
    setKind(k);
    setGenreId(null); // gêneros diferem por tipo
  };

  return (
    <div className="flex gap-3 sm:gap-4 animate-fade-in">
      {/* Sidebar de tipos */}
      <aside className="shrink-0 flex flex-col gap-2 w-16 sm:w-32">
        {KINDS.map(k => {
          const Icon = k.icon;
          const active = k.key === kind;
          return (
            <button key={k.key} onClick={() => changeKind(k.key)}
              className={`flex flex-col sm:flex-row items-center sm:gap-2 gap-1 rounded-lg px-2 py-3 text-xs sm:text-sm font-medium transition border ${
                active ? 'bg-primary/15 text-primary border-primary/40' : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
              }`}>
              <Icon className="w-5 h-5" />
              {k.label}
            </button>
          );
        })}
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={genreId ?? ''} onChange={e => setGenreId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todas categorias</option>
            {genres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className={selectCls} value={year ?? ''} onChange={e => setYear(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todos os anos</option>
            {BROWSE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={selectCls} value={minRating ?? ''} onChange={e => setMinRating(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Qualquer nota</option>
            {BROWSE_RATINGS.map(r => <option key={r.value} value={r.value}>Nota {r.label}</option>)}
          </select>
        </div>

        {/* Grid */}
        {items.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {items.map(m => <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} onClick={() => onOpen(m)} />)}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        )}

        {!loading && items.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10">Nada encontrado com esses filtros.</p>
        )}

        {!loading && !done && items.length > 0 && (
          <Button variant="outline" className="w-full" onClick={loadMore}>Carregar mais</Button>
        )}
      </div>
    </div>
  );
}
