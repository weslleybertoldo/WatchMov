import { useState } from 'react';
import { MediaSummary, searchMulti } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Clock } from 'lucide-react';

interface SearchViewProps {
  onOpen: (media: MediaSummary) => void;
}

const HISTORY_KEY = 'watchmov_search_history';

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 10) : [];
  } catch { return []; }
}

export default function SearchView({ onOpen }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);

  const pushHistory = (term: string) => {
    const t = term.trim();
    if (!t) return;
    const next = [t, ...history.filter(h => h.toLowerCase() !== t.toLowerCase())].slice(0, 10);
    setHistory(next);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  };

  const run = async (term = query) => {
    const t = term.trim();
    if (!t) return;
    if (t !== query) setQuery(t);
    setLoading(true);
    setSearched(true);
    pushHistory(t);
    try {
      setResults(await searchMulti(t));
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
          placeholder="Buscar filmes, séries e animes..."
          className="pl-9 bg-muted/50 border-border h-11"
        />
      </div>

      {/* Histórico: aparece quando ainda não buscou nesta sessão e há histórico. */}
      {!loading && !searched && history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Pesquisas recentes</span>
            <button onClick={clearHistory} className="text-xs text-muted-foreground hover:text-primary">Limpar</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map(h => (
              <button key={h} onClick={() => run(h)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted text-sm text-foreground hover:bg-secondary">
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

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
