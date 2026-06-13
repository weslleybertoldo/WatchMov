import { useState } from 'react';
import { MediaSummary, searchMulti } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';

interface SearchViewProps {
  onOpen: (media: MediaSummary) => void;
}

export default function SearchView({ onOpen }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      setResults(await searchMulti(query));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
          placeholder="Buscar filmes e séries..."
          className="pl-9 bg-muted/50 border-border h-11"
        />
      </div>

      {loading && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {results.map(m => <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} onClick={() => onOpen(m)} />)}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">Nada encontrado.</p>
      )}
    </div>
  );
}
