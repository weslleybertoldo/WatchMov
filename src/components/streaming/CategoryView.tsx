import { useEffect, useState, useCallback, useRef } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface CategoryViewProps {
  title: string;
  loadPage: (page: number) => Promise<MediaSummary[]>;
  onOpen: (media: MediaSummary) => void;
  onBack: () => void;
  cacheKey?: string; // preserva itens/página ao abrir um título e voltar
}

// Cache module-level por cacheKey: ao remontar (voltar de um título), restaura
// os itens já carregados para a altura da página ser a mesma → o scroll-restore
// global (Index) reposiciona corretamente, sem voltar ao topo.
interface CatState { items: MediaSummary[]; page: number; done: boolean; }
const catCache = new Map<string, CatState>();

export default function CategoryView({ title, loadPage, onOpen, onBack, cacheKey }: CategoryViewProps) {
  const cached = cacheKey ? catCache.get(cacheKey) : undefined;
  const [items, setItems] = useState<MediaSummary[]>(cached?.items ?? []);
  const [page, setPage] = useState(cached?.page ?? 1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(cached?.done ?? false);
  const didInit = useRef(false);

  const persist = useCallback((next: Partial<CatState>) => {
    if (!cacheKey) return;
    const cur = catCache.get(cacheKey) ?? { items: [], page: 1, done: false };
    catCache.set(cacheKey, { ...cur, ...next });
  }, [cacheKey]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await loadPage(p);
      setItems(prev => {
        const seen = new Set(prev.map(i => `${i.type}-${i.tmdbId}`));
        const merged = [...prev, ...res.filter(i => !seen.has(`${i.type}-${i.tmdbId}`))];
        persist({ items: merged, page: p, done: res.length === 0 });
        return merged;
      });
      if (res.length === 0) setDone(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (cached) return;     // restaurado do cache → não refaz fetch
    load(1);
  }, [load, cached]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9"><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold">{title}</h1>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {items.map(m => (
          <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} onClick={() => onOpen(m)} />
        ))}
      </div>
      {loading && (
        <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      )}
      {!loading && !done && items.length > 0 && (
        <Button variant="outline" className="w-full" onClick={loadMore}>Carregar mais</Button>
      )}
    </div>
  );
}
