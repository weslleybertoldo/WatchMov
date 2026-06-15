import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  MediaSummary, discoverFilter, type BrowseKind,
  MOVIE_GENRES, TV_GENRES, ANIME_GENRES, BROWSE_YEARS, BROWSE_RATINGS,
} from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { Film, Tv, Sparkles, Loader2, ChevronDown, Check } from 'lucide-react';

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

// Cache module-level: sobrevive ao desmontar/remontar (abrir título e voltar).
interface BrowseState {
  kind: BrowseKind;
  genreIds: number[];
  years: number[];
  minRating: number | null;
  items: MediaSummary[];
  page: number;
  done: boolean;
}
let browseCache: BrowseState | null = null;

// Dropdown com checkboxes (multi-seleção).
function MultiSelect({ label, options, selected, onToggle }: {
  label: string;
  options: { value: number; label: string }[];
  selected: number[];
  onToggle: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const text = selected.length === 0 ? label : `${label} (${selected.length})`;
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`h-9 inline-flex items-center gap-1 rounded-lg border px-2.5 text-sm transition ${
          selected.length ? 'bg-primary/15 text-primary border-primary/40' : 'bg-muted/60 text-foreground border-border'
        }`}>
        {text} <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 max-h-64 w-44 overflow-y-auto rounded-lg border border-border bg-background shadow-lg p-1">
            {options.map(o => {
              const on = selected.includes(o.value);
              return (
                <button key={o.value} onClick={() => onToggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-muted">
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}>
                    {on && <Check className="w-3 h-3" />}
                  </span>
                  {o.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function BrowseView({ onOpen }: BrowseViewProps) {
  const c = browseCache;
  const [kind, setKind] = useState<BrowseKind>(c?.kind ?? 'movie');
  const [genreIds, setGenreIds] = useState<number[]>(c?.genreIds ?? []);
  const [years, setYears] = useState<number[]>(c?.years ?? []);
  const [minRating, setMinRating] = useState<number | null>(c?.minRating ?? null);

  const [items, setItems] = useState<MediaSummary[]>(c?.items ?? []);
  const [page, setPage] = useState(c?.page ?? 1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(c?.done ?? false);

  const genres = useMemo(() => genresFor(kind), [kind]);
  const didInit = useRef(false);

  const load = useCallback(async (p: number, reset: boolean) => {
    setLoading(true);
    try {
      const res = await discoverFilter({ kind, genreIds, years, minRating, page: p });
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
  }, [kind, genreIds, years, minRating]);

  // Recarrega do zero quando tipo/filtros mudam. No 1º mount com cache, mantém.
  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true;
      if (browseCache) return; // restaurado do cache → não refaz fetch
    }
    setPage(1);
    setDone(false);
    load(1, true);
  }, [load]);

  // Persiste o estado para sobreviver à remontagem.
  useEffect(() => {
    browseCache = { kind, genreIds, years, minRating, items, page, done };
  }, [kind, genreIds, years, minRating, items, page, done]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next, false);
  };

  const changeKind = (k: BrowseKind) => {
    if (k === kind) return;
    setKind(k);
    setGenreIds([]); // gêneros diferem por tipo
  };
  const toggle = (arr: number[], set: (v: number[]) => void, v: number) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Tipos: 3 lado a lado no topo */}
      <div className="grid grid-cols-3 gap-2">
        {KINDS.map(k => {
          const Icon = k.icon;
          const active = k.key === kind;
          return (
            <button key={k.key} onClick={() => changeKind(k.key)}
              className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-medium transition border ${
                active ? 'bg-primary/15 text-primary border-primary/40' : 'text-muted-foreground border-border hover:text-foreground hover:bg-muted/50'
              }`}>
              <Icon className="w-4 h-4" />
              {k.label}
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <MultiSelect label="Categorias" selected={genreIds}
          options={genres.map(g => ({ value: g.id, label: g.name }))}
          onToggle={v => toggle(genreIds, setGenreIds, v)} />
        <MultiSelect label="Anos" selected={years}
          options={BROWSE_YEARS.map(y => ({ value: y, label: String(y) }))}
          onToggle={v => toggle(years, setYears, v)} />
        <select
          className="h-9 rounded-lg bg-muted/60 border border-border px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={minRating ?? ''} onChange={e => setMinRating(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Qualquer nota</option>
          {BROWSE_RATINGS.map(r => <option key={r.value} value={r.value}>Nota {r.label}</option>)}
        </select>
      </div>

      {/* Grid (largura total) */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
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
  );
}
