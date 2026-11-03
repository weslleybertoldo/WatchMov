import { useEffect, useMemo, useState } from 'react';
import { Globe2, RadioTower, Search } from 'lucide-react';
import { fetchAoVivo, fetchMundo, categoriesOf, filtrarCanais, type Channel } from '@/lib/liveTv';
import { bandeira } from '@/lib/iptvOrg';
import Grade from './Grade';

interface LiveTvViewProps {
  onPlay: (ch: Channel) => void;
}

// 03/11/2026 (pedido do Weslley): os canais do iptv-org do Brasil entram nas categorias de sempre e o mundo vira a
// ÚLTIMA aba, "Mundo", com as categorias dele. Lista grande aparece em páginas (o Mundo tem ~11 mil canais).
const TODOS = 'Todos';
const MUNDO = 'Mundo';
const TODAS = 'Todas';
const PAGINA = 60;

function Chips({ itens, ativo, onEscolher, rotulo }: { itens: string[]; ativo: string; onEscolher: (c: string) => void; rotulo: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar" role="tablist" aria-label={rotulo}>
      {itens.map(c => (
        <button key={c} onClick={() => onEscolher(c)} role="tab" aria-selected={ativo === c}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition inline-flex items-center gap-1 ${ativo === c ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border/60 hover:text-foreground'}`}>
          {c === MUNDO && <Globe2 className="w-3.5 h-3.5" />}
          {c}
        </button>
      ))}
    </div>
  );
}

function LogoDoCanal({ ch }: { ch: Channel }) {
  const [falhou, setFalhou] = useState(false);
  return ch.logo && !falhou
    ? <img src={ch.logo} alt={ch.name} loading="lazy" onError={() => setFalhou(true)} className="max-h-full max-w-full object-contain" />
    : <RadioTower className="w-6 h-6 text-muted-foreground" />;
}

export default function LiveTvView({ onPlay }: LiveTvViewProps) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState(false);
  const [cat, setCat] = useState(TODOS);
  const [q, setQ] = useState('');
  const [mundo, setMundo] = useState<Channel[] | null>(null);
  const [erroMundo, setErroMundo] = useState(false);
  const [catMundo, setCatMundo] = useState(TODAS);
  const [limite, setLimite] = useState(PAGINA);

  const load = (force = false) => {
    setError(false); setChannels(null);
    fetchAoVivo(force).then(setChannels).catch(() => setError(true));
  };
  const loadMundo = (force = false) => {
    setErroMundo(false); setMundo(null);
    fetchMundo(force).then(setMundo).catch(() => setErroMundo(true));
  };
  useEffect(() => { load(); }, []);

  const noMundo = cat === MUNDO;
  // O Mundo (~2,6 MB) só baixa na 1ª vez que a aba abre.
  useEffect(() => {
    if (noMundo && !mundo && !erroMundo) loadMundo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noMundo]);
  // Trocou de categoria ou de busca → volta pra 1ª página.
  useEffect(() => { setLimite(PAGINA); }, [cat, catMundo, q]);

  const cats = useMemo(() => [TODOS, ...(channels ? categoriesOf(channels) : []), MUNDO], [channels]);
  const catsMundo = useMemo(() => mundo ? [TODAS, ...categoriesOf(mundo)] : [TODAS], [mundo]);
  const lista = noMundo ? mundo : channels;
  const filtered = useMemo(() => {
    if (!lista) return [];
    const categoria = noMundo ? (catMundo === TODAS ? null : catMundo) : (cat === TODOS ? null : cat);
    return filtrarCanais(lista, categoria, q);
  }, [lista, noMundo, cat, catMundo, q]);
  const visiveis = useMemo(() => filtered.slice(0, limite), [filtered, limite]);

  const falhou = noMundo ? erroMundo : error;
  const tentarDeNovo = () => (noMundo ? loadMundo(true) : load(true));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <RadioTower className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Ao Vivo</h1>
        {lista && (
          <span className="text-xs text-muted-foreground">
            {lista.length.toLocaleString('pt-BR')} canais{noMundo ? ' no mundo' : ''}
          </span>
        )}
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={noMundo ? 'Buscar canal no mundo...' : 'Buscar canal...'}
          className="w-full pl-9 pr-3 h-10 rounded-lg bg-card border border-border/60 text-sm outline-none focus:border-primary/60" />
      </div>

      {/* Categorias (Brasil) + Mundo no fim */}
      <Chips itens={cats} ativo={cat} onEscolher={setCat} rotulo="Categorias" />
      {/* Categorias do Mundo */}
      {noMundo && mundo && <Chips itens={catsMundo} ativo={catMundo} onEscolher={setCatMundo} rotulo="Categorias do mundo" />}
      {noMundo && mundo && (
        <p className="text-[11px] text-muted-foreground">Canais abertos do mundo todo. Alguns podem estar fora do ar.</p>
      )}

      {/* Estados */}
      {falhou ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os canais.</p>
          <button onClick={tentarDeNovo} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Tentar de novo</button>
        </div>
      ) : !lista ? (
        /* W4 do raio-x (02/11/2026): esqueleto dos cartões de canal no lugar do spinner. */
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3" data-esqueleto aria-busy="true" aria-label="Carregando">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="aspect-video rounded-lg bg-muted/40 animate-pulse" />
              <div className="h-3 w-3/4 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum canal encontrado.</p>
      ) : (
        <>
          {/* W5 do raio-x (02/11/2026): na TV só as linhas perto do foco ficam montadas (Grade). */}
          <Grade itens={visiveis} chave={ch => String(ch.id)}>
            {ch => (
              <button onClick={() => onPlay(ch)} data-canal={ch.url ? 'iptv' : 'superflix'}
                className="group flex flex-col gap-1.5 text-left">
                <div className="aspect-video rounded-lg bg-card border border-border/60 overflow-hidden flex items-center justify-center p-2 group-hover:border-primary/60 transition">
                  <LogoDoCanal ch={ch} />
                </div>
                <span className="text-[11px] text-muted-foreground truncate group-hover:text-foreground">
                  {noMundo && ch.country ? `${bandeira(ch.country)} ` : ''}{ch.name}
                </span>
              </button>
            )}
          </Grade>
          {filtered.length > visiveis.length && (
            <div className="flex justify-center pt-2">
              <button onClick={() => setLimite(l => l + PAGINA)}
                className="px-4 py-2 rounded-lg bg-card border border-border/60 text-sm font-medium hover:border-primary/60">
                Mostrar mais ({(filtered.length - visiveis.length).toLocaleString('pt-BR')} canais)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
