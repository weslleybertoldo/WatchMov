import { useEffect, useMemo, useState } from 'react';
import { Loader2, RadioTower, Search } from 'lucide-react';
import { fetchChannels, categoriesOf, type Channel } from '@/lib/liveTv';

interface LiveTvViewProps {
  onPlay: (ch: Channel) => void;
}

export default function LiveTvView({ onPlay }: LiveTvViewProps) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState(false);
  const [cat, setCat] = useState('Todos');
  const [q, setQ] = useState('');

  const load = (force = false) => {
    setError(false); setChannels(null);
    fetchChannels(force).then(setChannels).catch(() => setError(true));
  };
  useEffect(() => { load(); }, []);

  const cats = useMemo(() => channels ? ['Todos', ...categoriesOf(channels)] : ['Todos'], [channels]);
  const filtered = useMemo(() => {
    if (!channels) return [];
    const term = q.trim().toLowerCase();
    return channels.filter(c =>
      (cat === 'Todos' || c.category === cat) &&
      (!term || c.name.toLowerCase().includes(term)));
  }, [channels, cat, q]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <RadioTower className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Ao Vivo</h1>
        {channels && <span className="text-xs text-muted-foreground">{channels.length} canais</span>}
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar canal..."
          className="w-full pl-9 pr-3 h-10 rounded-lg bg-card border border-border/60 text-sm outline-none focus:border-primary/60" />
      </div>

      {/* Categorias */}
      {channels && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
          {cats.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${cat === c ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border/60 hover:text-foreground'}`}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Estados */}
      {error ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os canais.</p>
          <button onClick={() => load(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Tentar de novo</button>
        </div>
      ) : !channels ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum canal encontrado.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {filtered.map(ch => (
            <button key={ch.id} onClick={() => onPlay(ch)}
              className="group flex flex-col gap-1.5 text-left">
              <div className="aspect-video rounded-lg bg-card border border-border/60 overflow-hidden flex items-center justify-center p-2 group-hover:border-primary/60 transition">
                {ch.logo
                  ? <img src={ch.logo} alt={ch.name} loading="lazy" className="max-h-full max-w-full object-contain" />
                  : <RadioTower className="w-6 h-6 text-muted-foreground" />}
              </div>
              <span className="text-[11px] text-muted-foreground truncate group-hover:text-foreground">{ch.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
