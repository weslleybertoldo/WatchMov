import { memo, useEffect, useRef, useState } from 'react';
import type { TmdbCollection } from '@/lib/tmdb';
import { isTv } from '@/lib/device';
import {
  DESTAQUES, UNIVERSOS, carregarColecoes, colecoesLabel, colecoesProntas, filmesLabel, type Universo, type UniversoId,
} from '@/lib/colecoes';
import { Folder, Loader2, Plus } from 'lucide-react';

export interface ColecaoAbrir { id: number; nome: string }

// As duas "folhas" atrás da capa: é uma pasta, não um filme.
function Folhas() {
  return (
    <>
      <div aria-hidden className="absolute inset-x-3 top-0 h-8 rounded-t-lg bg-muted-foreground/25" />
      <div aria-hidden className="absolute inset-x-1.5 top-1 h-8 rounded-t-lg bg-muted-foreground/45" />
    </>
  );
}

// Pasta de uma coleção (saga/trilogia): a capa da coleção com duas "folhas" atrás, a pastinha com o número de
// filmes no pé da capa, o nome (até 2 linhas: o que diferencia as sagas costuma estar no fim, "Batman (1989–1997)",
// "Homem-Aranha (Tom Holland)") e "N filmes". Botão com data-tv-card: na TV o controle anda por ela igual a um
// cartaz, e o foco volta nela (data-tv-key) ao sair da pasta. Sem data-tv-hold: coleção não vai pros favoritos.
export function CollectionCard({ colecao, onClick }: { colecao: TmdbCollection; onClick: () => void }) {
  const n = colecao.parts.length;
  return (
    <button
      onClick={onClick}
      data-tv-card
      data-tv-key={`col-${colecao.id}`}
      data-colecao={colecao.id}
      className="toque relative shrink-0 w-28 sm:w-32 text-left group select-none [-webkit-touch-callout:none]"
    >
      <div className="relative pt-2">
        <Folhas />
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
      <p className="mt-1 text-xs leading-4 min-h-8 font-medium text-foreground line-clamp-2 break-words">{colecao.name}</p>
      <p className="text-[10px] text-muted-foreground">{filmesLabel(n)}</p>
    </button>
  );
}

// W5 (pedido dele 01/11/2026): pasta de um UNIVERSO (Marvel, DC), que guarda as pastas das sagas dele. A TMDB não tem
// universo, então não há capa: o nome grande na cor do universo, as mesmas folhas atrás e o número de coleções no pé.
// Não depende da TMDB: aparece na hora, antes das sagas carregarem.
const FUNDO: Record<UniversoId, string> = {
  marvel: 'bg-gradient-to-br from-[#ec1d24] to-[#7a0b10]',
  dc: 'bg-gradient-to-br from-[#0476f2] to-[#06295c]',
};

export function UniversoCard({ universo, onClick }: { universo: Universo; onClick: () => void }) {
  const n = universo.colecoes.length;
  return (
    <button
      onClick={onClick}
      data-tv-card
      data-tv-key={`uni-${universo.id}`}
      data-universo={universo.id}
      className="toque relative shrink-0 w-28 sm:w-32 text-left group select-none [-webkit-touch-callout:none]"
    >
      <div className="relative pt-2">
        <Folhas />
        <div className={`tv-poster relative rounded-lg overflow-hidden aspect-[2/3] ring-1 ring-border group-hover:ring-primary transition-all flex items-center justify-center ${FUNDO[universo.id]}`}>
          <span className="px-2 text-center text-white font-black uppercase tracking-tight leading-none text-xl sm:text-2xl [text-shadow:0_2px_6px_rgb(0_0_0/0.45)]">
            {universo.nome}
          </span>
          <span className="absolute bottom-1 left-1 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/75 text-white">
            <Folder className="w-3 h-3" /> {n}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs leading-4 min-h-8 font-medium text-foreground line-clamp-2">{universo.nome}</p>
      <p className="text-[10px] text-muted-foreground">{colecoesLabel(n)}</p>
    </button>
  );
}

// Espaço do tamanho de uma pasta (capa + nome + "N filmes"): a fileira entra sem empurrar a página.
function PastaReservada() {
  return (
    <div data-fileira-reservada aria-hidden="true" className="shrink-0 w-28 sm:w-32 pt-2">
      <div className="rounded-lg bg-muted/40 aspect-[2/3]" />
      <p className="mt-1 text-xs leading-4 min-h-8">&nbsp;</p>
      <p className="text-[10px]">&nbsp;</p>
    </div>
  );
}

const PERTO_DA_TELA = '600px 0px';                 // ~1 tela da TV (540 CSS px) acima e abaixo
const scrollDasFileiras = new Map<string, number>(); // posição horizontal: sobrevive ao abrir uma pasta e voltar

interface FileiraProps {
  chave: string;                                  // data-row-key (âncora do scroll ao voltar) e posição horizontal
  titulo: string;
  ids: number[];
  universos?: Universo[];                         // pastas Marvel/DC no começo da fileira
  onOpen: (c: ColecaoAbrir) => void;
  onOpenUniverso?: (id: UniversoId) => void;
  onSeeAll?: () => void;
  adiar?: boolean;                                // só busca na TMDB quando a fileira chega perto da tela
}

// Uma fileira de pastas: a "Coleções" da aba Filmes e cada gênero do "Ver tudo". As pastas aparecem de lote em lote
// (8 por vez); no "Ver tudo" (adiar) a fileira só pede as coleções dela quando chega perto da tela — são ~250 sagas
// e a Fire TV tem 1 GB. TMDB fora: a fileira some (ficam só as pastas Marvel/DC, que não dependem dela).
export function FileiraDeColecoes({ chave, titulo, ids, universos = [], onOpen, onOpenUniverso, onSeeAll, adiar }: FileiraProps) {
  // Sem sagas (a fileira "Universos" do "Ver tudo" só tem Marvel e DC): já nasce completa, sem ir na TMDB.
  const [lista, setLista] = useState<TmdbCollection[] | null>(() => (ids.length ? colecoesProntas(ids) ?? null : []));
  const [completa, setCompleta] = useState(() => !ids.length || !!colecoesProntas(ids));
  const [perto, setPerto] = useState(() => !adiar || !ids.length || !!colecoesProntas(ids));
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (perto) return;
    const el = rowRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setPerto(true); return; }
    const io = new IntersectionObserver((es) => {
      if (!es.some(e => e.isIntersecting)) return;
      setPerto(true);
      io.disconnect();
    }, { rootMargin: PERTO_DA_TELA });
    io.observe(el);
    return () => io.disconnect();
  }, [perto]);

  useEffect(() => {
    if (!perto || completa) return;
    let vivo = true;
    carregarColecoes(ids, 8, parcial => { if (vivo) setLista(parcial); })
      .then(l => { if (vivo) { setLista(l); setCompleta(true); } })
      .catch(() => { if (vivo) { setLista(l => l ?? []); setCompleta(true); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perto]);

  // Volta pra mesma posição horizontal quando a fileira fica completa (de novo, ao voltar de uma pasta).
  useEffect(() => {
    if (completa && scrollRef.current) scrollRef.current.scrollLeft = scrollDasFileiras.get(chave) ?? 0;
  }, [completa, chave]);

  const temSagas = !!lista?.length;
  if (completa && !temSagas && universos.length === 0) return null;

  return (
    <div ref={rowRef} className="space-y-2" data-row-key={chave}>
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base sm:text-lg font-bold text-foreground">{titulo}</h2>
        {onSeeAll && (
          // Na TV o "Ver tudo" sai do caminho das setas: o cartão "Ver mais" no fim da fileira faz o mesmo.
          <button onClick={onSeeAll} tabIndex={isTv() ? -1 : undefined} className="text-xs text-muted-foreground hover:text-primary">Ver tudo</button>
        )}
      </div>
      <div ref={scrollRef} onScroll={() => { if (scrollRef.current) scrollDasFileiras.set(chave, scrollRef.current.scrollLeft); }}
        className="flex gap-3 overflow-x-auto scroll-smooth snap-x pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {universos.map(u => (
          <div key={u.id} className="snap-start">
            <UniversoCard universo={u} onClick={() => onOpenUniverso?.(u.id)} />
          </div>
        ))}
        {(lista ?? []).map(col => (
          <div key={col.id} className="snap-start">
            <CollectionCard colecao={col} onClick={() => onOpen({ id: col.id, nome: col.name })} />
          </div>
        ))}
        {!completa && (temSagas || universos.length ? (
          <div className="shrink-0 flex items-center px-4 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <PastaReservada />
        ))}
        {completa && onSeeAll && (
          <button onClick={onSeeAll}
            className="shrink-0 w-28 sm:w-32 mt-2 aspect-[2/3] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition snap-start">
            <Plus className="w-7 h-7" />
            <span className="text-xs mt-1">Ver mais</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Fileira "Coleções" no topo da aba Filmes (pedido dele 01/11/2026): as pastas Marvel e DC, as sagas em destaque e
// "Ver tudo" (na TV, o cartão "Ver mais" no fim da fileira).
// W2 do raio-x (02/11/2026): memo — não redesenha quando o Index redesenha (as 3 funções vêm de useCallback).
export const CollectionRow = memo(function CollectionRow({ onOpen, onOpenUniverso, onSeeAll }: {
  onOpen: (c: ColecaoAbrir) => void; onOpenUniverso: (id: UniversoId) => void; onSeeAll: () => void;
}) {
  return (
    <FileiraDeColecoes chave="colecoes" titulo="Coleções" ids={DESTAQUES} universos={UNIVERSOS}
      onOpen={onOpen} onOpenUniverso={onOpenUniverso} onSeeAll={onSeeAll} />
  );
});
