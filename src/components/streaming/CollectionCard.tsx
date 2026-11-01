import { useEffect, useRef, useState } from 'react';
import type { TmdbCollection } from '@/lib/tmdb';
import { isTv } from '@/lib/device';
import { COLECOES, COLECOES_NA_FILEIRA, carregarColecoes, colecoesProntas, filmesLabel } from '@/lib/colecoes';
import { Folder, Loader2, Plus } from 'lucide-react';

export interface ColecaoAbrir { id: number; nome: string }

// Pasta de uma coleção (saga/trilogia): a capa da coleção com duas "folhas" atrás, a pastinha com o número de
// filmes no pé da capa, o nome e "N filmes". Botão com data-tv-card: na TV o controle anda por ela igual a um
// cartaz, e o foco volta nela (data-tv-key) ao sair da pasta. Sem data-tv-hold: coleção não vai pros favoritos.
export function CollectionCard({ colecao, onClick }: { colecao: TmdbCollection; onClick: () => void }) {
  const n = colecao.parts.length;
  return (
    <button
      onClick={onClick}
      data-tv-card
      data-tv-key={`col-${colecao.id}`}
      data-colecao={colecao.id}
      className="relative shrink-0 w-28 sm:w-32 text-left group select-none [-webkit-touch-callout:none]"
    >
      <div className="relative pt-2">
        {/* as folhas de trás: é uma pasta, não um filme */}
        <div aria-hidden className="absolute inset-x-3 top-0 h-8 rounded-t-lg bg-muted-foreground/25" />
        <div aria-hidden className="absolute inset-x-1.5 top-1 h-8 rounded-t-lg bg-muted-foreground/45" />
        <div className="tv-poster relative rounded-lg overflow-hidden bg-muted aspect-[2/3] ring-1 ring-border group-hover:ring-primary transition-all">
          {colecao.posterUrl ? (
            <img src={colecao.posterUrl} alt={colecao.name} loading="lazy" draggable={false} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Folder className="w-7 h-7" /></div>
          )}
          <span className="absolute bottom-1 left-1 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/75 text-white">
            <Folder className="w-3 h-3" /> {n}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs font-medium text-foreground truncate">{colecao.name}</p>
      <p className="text-[10px] text-muted-foreground">{filmesLabel(n)}</p>
    </button>
  );
}

const IDS_DA_FILEIRA = COLECOES.slice(0, COLECOES_NA_FILEIRA).map(c => c.id);
let scrollDaFileira = 0;   // posição horizontal: sobrevive ao abrir uma pasta e voltar

// Fileira "Coleções" no topo da aba Filmes (pedido dele 01/11/2026): as pastas das sagas mais populares, com
// "Ver tudo" (na TV, o cartão "Ver mais" no fim da fileira). TMDB fora: a fileira some, como as outras.
export function CollectionRow({ onOpen, onSeeAll }: { onOpen: (c: ColecaoAbrir) => void; onSeeAll: () => void }) {
  const [lista, setLista] = useState<TmdbCollection[] | null>(() => colecoesProntas(IDS_DA_FILEIRA) ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lista) return;
    let vivo = true;
    carregarColecoes(IDS_DA_FILEIRA).then(l => { if (vivo) setLista(l); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lista?.length && scrollRef.current) scrollRef.current.scrollLeft = scrollDaFileira;
  }, [lista]);

  if (lista && lista.length === 0) return null;

  return (
    <div className="space-y-2" data-row-key="colecoes">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base sm:text-lg font-bold text-foreground">Coleções</h2>
        <button onClick={onSeeAll} tabIndex={isTv() ? -1 : undefined} className="text-xs text-muted-foreground hover:text-primary">Ver tudo</button>
      </div>
      <div ref={scrollRef} onScroll={() => { if (scrollRef.current) scrollDaFileira = scrollRef.current.scrollLeft; }}
        className="flex gap-3 overflow-x-auto scroll-smooth snap-x pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!lista ? (
          <div className="flex items-center gap-2 text-muted-foreground py-10 px-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            {lista.map(c => (
              <div key={c.id} className="snap-start">
                <CollectionCard colecao={c} onClick={() => onOpen({ id: c.id, nome: c.name })} />
              </div>
            ))}
            <button onClick={onSeeAll}
              className="shrink-0 w-28 sm:w-32 mt-2 aspect-[2/3] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition snap-start">
              <Plus className="w-7 h-7" />
              <span className="text-xs mt-1">Ver mais</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
