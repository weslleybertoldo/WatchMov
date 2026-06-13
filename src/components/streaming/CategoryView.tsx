import { useEffect, useState, useCallback } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface CategoryViewProps {
  title: string;
  loadPage: (page: number) => Promise<MediaSummary[]>;
  onOpen: (media: MediaSummary) => void;
  onBack: () => void;
}

export default function CategoryView({ title, loadPage, onOpen, onBack }: CategoryViewProps) {
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await loadPage(p);
      setItems(prev => {
        const seen = new Set(prev.map(i => `${i.type}-${i.tmdbId}`));
        return [...prev, ...res.filter(i => !seen.has(`${i.type}-${i.tmdbId}`))];
      });
      if (res.length === 0) setDone(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(1); }, [load]);

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
