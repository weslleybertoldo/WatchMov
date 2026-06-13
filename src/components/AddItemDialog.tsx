import { useState } from 'react';
import { WatchItem, Season } from '@/types/watch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Minus, Search, Loader2, Check, Star } from 'lucide-react';
import { generateId } from '@/store/useWatchStore';
import { TMDB_ENABLED, searchTitle, getDetails, type TmdbSearchResult } from '@/lib/tmdb';
import { formatRating } from '@/lib/formatters';
import { toast } from 'sonner';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  onAdd: (item: Omit<WatchItem, 'id' | 'createdAt'>) => void;
}

interface TmdbMeta {
  tmdbId?: number;
  imdbId?: string;
  posterUrl?: string;
  synopsis?: string;
  genre?: string;
  rating?: number;
  votes?: number;
}

export default function AddItemDialog({ open, onOpenChange, sectionId, onAdd }: AddItemDialogProps) {
  const [type, setType] = useState<'movie' | 'series'>('series');
  const [title, setTitle] = useState('');
  // Movie
  const [movieDuration, setMovieDuration] = useState('');
  // Series
  const [seasonCount, setSeasonCount] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<{ episodes: string; duration: string }[]>([
    { episodes: '12', duration: '24' },
  ]);
  // TMDB
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [meta, setMeta] = useState<TmdbMeta>({});

  const updateSeasonCount = (count: number) => {
    if (count < 1) return;
    setSeasonCount(count);
    setSeasonEpisodes(prev => {
      const arr = [...prev];
      while (arr.length < count) arr.push({ episodes: '12', duration: '24' });
      return arr.slice(0, count);
    });
  };

  const updateSeasonField = (idx: number, field: 'episodes' | 'duration', value: string) => {
    setSeasonEpisodes(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchTitle(query, type === 'series' ? 'tv' : 'movie');
      setResults(res);
      if (res.length === 0) toast.info('Nenhum resultado no TMDB', { description: 'Você pode preencher manualmente.' });
    } catch (e) {
      toast.error('Falha na busca TMDB', { description: e instanceof Error ? e.message : 'erro' });
    } finally {
      setSearching(false);
    }
  };

  const handlePick = async (r: TmdbSearchResult) => {
    setTitle(r.title);
    setResults([]);
    setQuery('');
    try {
      const d = await getDetails(r.tmdbId, r.type);
      setMeta({ tmdbId: d.tmdbId, imdbId: d.imdbId, posterUrl: d.posterUrl, synopsis: d.synopsis, genre: d.genre, rating: d.rating, votes: d.votes });
      if (r.type === 'movie') {
        if (d.runtime) setMovieDuration(String(d.runtime));
      } else if (d.seasons && d.seasons.length > 0) {
        setSeasonCount(d.seasons.length);
        setSeasonEpisodes(d.seasons.map(s => ({ episodes: String(s.totalEpisodes), duration: String(s.episodeDuration) })));
      }
    } catch (e) {
      // mantém ao menos capa/sinopse/nota da busca
      setMeta({ tmdbId: r.tmdbId, posterUrl: r.posterUrl, synopsis: r.overview, rating: r.rating, votes: r.votes });
      toast.error('Falha ao buscar detalhes', { description: e instanceof Error ? e.message : 'erro' });
    }
  };

  const resetAll = () => {
    setType('series');
    setTitle('');
    setMovieDuration('');
    setSeasonCount(1);
    setSeasonEpisodes([{ episodes: '12', duration: '24' }]);
    setQuery('');
    setResults([]);
    setMeta({});
  };

  const handleSubmit = () => {
    if (!title.trim()) return;

    const common = {
      sectionId,
      title: title.trim(),
      tmdbId: meta.tmdbId,
      imdbId: meta.imdbId,
      posterUrl: meta.posterUrl,
      synopsis: meta.synopsis,
      genre: meta.genre,
      rating: meta.rating,
      votes: meta.votes,
      favorite: false,
    };

    if (type === 'movie') {
      onAdd({
        ...common,
        type: 'movie',
        totalDuration: parseInt(movieDuration) || 120,
        watchedDuration: 0,
        completed: false,
      });
    } else {
      const seasons: Season[] = seasonEpisodes.map((se, i) => ({
        id: generateId(),
        number: i + 1,
        totalEpisodes: parseInt(se.episodes) || 12,
        watchedEpisodes: 0,
        episodeDuration: parseInt(se.duration) || 24,
      }));
      onAdd({
        ...common,
        type: 'series',
        seasons,
      });
    }

    resetAll();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar novo item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Type selector */}
          <div className="flex gap-2">
            <button
              onClick={() => { setType('series'); setResults([]); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                type === 'series' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              📺 Série / Anime
            </button>
            <button
              onClick={() => { setType('movie'); setResults([]); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                type === 'movie' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              🎬 Filme
            </button>
          </div>

          {/* TMDB search */}
          {TMDB_ENABLED && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Buscar no TMDB (preenche capa, sinopse e categoria)</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
                    placeholder={type === 'series' ? 'Nome da série/anime' : 'Nome do filme'}
                    className="pl-9 bg-muted border-border"
                  />
                </div>
                <Button variant="outline" onClick={handleSearch} disabled={searching}>
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
                </Button>
              </div>
              {results.length > 0 && (
                <div className="space-y-1 max-h-56 overflow-y-auto border border-border rounded-lg p-1">
                  {results.map(r => (
                    <button
                      key={r.tmdbId}
                      onClick={() => handlePick(r)}
                      className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-secondary text-left"
                    >
                      {r.posterUrl ? (
                        <img src={r.posterUrl} alt="" className="w-10 h-15 rounded object-cover bg-muted shrink-0" />
                      ) : (
                        <div className="w-10 h-15 rounded bg-muted shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                        {r.year && <p className="text-xs text-muted-foreground">{r.year}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected metadata preview */}
          {(meta.posterUrl || meta.genre || meta.synopsis) && (
            <div className="flex gap-3 p-3 bg-muted/40 rounded-lg">
              {meta.posterUrl && <img src={meta.posterUrl} alt="" className="w-16 rounded object-cover shrink-0" />}
              <div className="min-w-0 space-y-1">
                <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="w-3 h-3" /> Dados do TMDB</span>
                {formatRating(meta.rating, meta.votes) && (
                  <p className="text-xs font-medium text-foreground flex items-center gap-1">
                    <Star className="w-3 h-3 fill-primary text-primary" /> {formatRating(meta.rating, meta.votes)}
                  </p>
                )}
                {meta.genre && <p className="text-xs text-muted-foreground">{meta.genre}</p>}
                {meta.synopsis && <p className="text-xs text-muted-foreground line-clamp-3">{meta.synopsis}</p>}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-sm text-muted-foreground">Título</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Nome do filme ou série"
              className="mt-1 bg-muted border-border"
            />
          </div>

          {type === 'movie' ? (
            <div>
              <label className="text-sm text-muted-foreground">Duração total (minutos)</label>
              <Input
                type="number"
                value={movieDuration}
                onChange={e => setMovieDuration(e.target.value)}
                placeholder="120"
                className="mt-1 bg-muted border-border"
              />
            </div>
          ) : (
            <>
              {/* Season count */}
              <div>
                <label className="text-sm text-muted-foreground">Número de temporadas</label>
                <div className="flex items-center gap-3 mt-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={() => updateSeasonCount(seasonCount - 1)}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span className="text-lg font-bold w-8 text-center">{seasonCount}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={() => updateSeasonCount(seasonCount + 1)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Season details */}
              <div className="space-y-3 max-h-48 overflow-y-auto">
                {seasonEpisodes.map((se, i) => (
                  <div key={i} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                    <span className="text-xs text-muted-foreground font-medium w-8">T{i + 1}</span>
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={se.episodes}
                        onChange={e => updateSeasonField(i, 'episodes', e.target.value)}
                        placeholder="Eps"
                        className="h-8 text-sm bg-muted border-border"
                      />
                      <span className="text-[10px] text-muted-foreground">episódios</span>
                    </div>
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={se.duration}
                        onChange={e => updateSeasonField(i, 'duration', e.target.value)}
                        placeholder="Min"
                        className="h-8 text-sm bg-muted border-border"
                      />
                      <span className="text-[10px] text-muted-foreground">min/ep</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <Button onClick={handleSubmit} className="w-full">
            Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
