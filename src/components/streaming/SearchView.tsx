import { useRef, useState } from 'react';
import { MediaSummary, searchMulti } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { esconderTeclado, isTv, mostrarTeclado } from '@/lib/device';

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

// Cache module-level: ao abrir um título e voltar, mostra de novo os resultados
// já pesquisados (em vez de voltar à tela de digitar).
let searchCache: { query: string; results: MediaSummary[]; searched: boolean } | null = null;

// Limpa o cache da busca — chamado pelo Index ao FECHAR a lupa (sair da busca).
// Abrir um título e voltar mantém a lupa aberta, então o cache persiste.
export function clearSearchCache() { searchCache = null; }

export default function SearchView({ onOpen }: SearchViewProps) {
  const [query, setQuery] = useState(searchCache?.query ?? '');
  const [results, setResults] = useState<MediaSummary[]>(searchCache?.results ?? []);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(searchCache?.searched ?? false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  // TV (pedido dele 26/09/2026): o campo focado pelo controle não abria o teclado e o OK buscava vazio.
  // Agora o OK no campo vazio (ou com o texto já pesquisado) abre o teclado; com texto novo, o "Avançar" do teclado
  // da Amazon (sai do campo) ou o OK pesquisam. O botão Buscar ao lado também.
  const tv = isTv();
  const abrirTeclado = useRef(false);
  const ultimaBusca = useRef<string | null>(searchCache?.searched ? searchCache.query : null);

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

  // Limpa a pesquisa atual (texto + resultados + cache persistido).
  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
    searchCache = null;
  };

  const run = async (term = query) => {
    const t = term.trim();
    if (!t) return;
    ultimaBusca.current = t;
    // TV: pesquisou → o teclado fecha e o campo solta o foco (o tvNav leva o foco pro 1º resultado).
    if (tv) { (document.activeElement as HTMLElement | null)?.blur?.(); esconderTeclado(); }
    if (t !== query) setQuery(t);
    setLoading(true);
    setSearched(true);
    pushHistory(t);
    try {
      const r = await searchMulti(t);
      setResults(r);
      searchCache = { query: t, results: r, searched: true };
    } catch {
      setResults([]);
      searchCache = { query: t, results: [], searched: true };
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const t = query.trim();
              if (tv && (!t || t === ultimaBusca.current)) { abrirTeclado.current = true; return; }
              run();
            }}
            // O teclado da TV abre no SOLTAR do OK.
            onKeyUp={e => {
              if (e.key !== 'Enter' || !abrirTeclado.current) return;
              abrirTeclado.current = false;
              mostrarTeclado();
            }}
            // O "Avançar" do teclado da Amazon não manda Enter: ele tira o foco do campo. Na TV, sair do campo com
            // texto novo já pesquisa.
            onBlur={() => { const t = query.trim(); if (tv && t && t !== ultimaBusca.current) run(); }}
            // type=search: o campo diz ao teclado que é uma busca (ação "pesquisar").
            type="search"
            enterKeyHint="search"
            placeholder="Buscar filmes, séries e animes..."
            className="pl-9 pr-9 bg-muted/50 border-border h-11 [&::-webkit-search-cancel-button]:hidden"
          />
          {(query || searched) && (
            <button onClick={clearSearch} title="Limpar"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {tv && (
          <Button className="h-11 shrink-0" onClick={() => run()} disabled={!query.trim()}>
            <Search className="w-4 h-4 mr-1" /> Buscar
          </Button>
        )}
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
