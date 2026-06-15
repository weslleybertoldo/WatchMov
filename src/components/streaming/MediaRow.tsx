import { useEffect, useRef, useState } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';

interface MediaRowProps {
  title: string;
  items?: MediaSummary[];               // pré-carregado (continuar/minha lista)
  loader?: () => Promise<MediaSummary[]>; // carrega sob demanda (TMDB)
  cacheKey?: string;                    // evita refetch ao trocar de aba
  numbered?: boolean;                   // Top 10
  onOpen: (media: MediaSummary) => void;
  onSeeAll?: () => void;
}

// cache simples em memória por cacheKey
const rowCache = new Map<string, MediaSummary[]>();
// posição do scroll horizontal por linha (sobrevive remontagem ao abrir detalhe)
const scrollCache = new Map<string, number>();

export default function MediaRow({ title, items, loader, cacheKey, numbered, onOpen, onSeeAll }: MediaRowProps) {
  const [data, setData] = useState<MediaSummary[]>(() => items ?? (cacheKey ? rowCache.get(cacheKey) ?? [] : []));
  const [loading, setLoading] = useState(!items && !(cacheKey && rowCache.has(cacheKey)));
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = cacheKey || title;

  // Restaura a posição horizontal ao (re)montar com os dados já carregados.
  useEffect(() => {
    if (!loading && scrollRef.current && scrollCache.has(scrollKey)) {
      scrollRef.current.scrollLeft = scrollCache.get(scrollKey)!;
    }
  }, [loading, scrollKey, data.length]);

  useEffect(() => {
    if (items) { setData(items); return; }
    if (!loader) return;
    if (cacheKey && rowCache.has(cacheKey)) { setData(rowCache.get(cacheKey)!); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    loader()
      .then(res => { if (!alive) return; if (cacheKey) rowCache.set(cacheKey, res); setData(res); })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, items]);

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  if (!loading && data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base sm:text-lg font-bold text-foreground">{title}</h2>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-xs text-muted-foreground hover:text-primary">Ver tudo</button>
        )}
      </div>
      <div className="relative group/row">
        {/* setas desktop */}
        <button onClick={() => scrollBy(-1)} className="hidden md:flex absolute left-0 top-0 bottom-0 z-20 w-8 items-center justify-center bg-gradient-to-r from-background/90 to-transparent opacity-0 group-hover/row:opacity-100 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div ref={scrollRef} onScroll={() => { if (scrollRef.current) scrollCache.set(scrollKey, scrollRef.current.scrollLeft); }} className="flex gap-3 overflow-x-auto scroll-smooth snap-x pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-10 px-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              {data.slice(0, 10).map((m, i) => (
                <div key={`${m.type}-${m.tmdbId}`} className="snap-start">
                  <MediaCard media={m} onClick={() => onOpen(m)} rank={numbered ? i + 1 : undefined} />
                </div>
              ))}
              {onSeeAll && (
                <button
                  onClick={onSeeAll}
                  className="shrink-0 w-28 sm:w-32 aspect-[2/3] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition snap-start"
                >
                  <Plus className="w-7 h-7" />
                  <span className="text-xs mt-1">Ver mais</span>
                </button>
              )}
            </>
          )}
        </div>
        <button onClick={() => scrollBy(1)} className="hidden md:flex absolute right-0 top-0 bottom-0 z-20 w-8 items-center justify-center bg-gradient-to-l from-background/90 to-transparent opacity-0 group-hover/row:opacity-100 transition">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
