import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaSummary, TmdbCollection } from '@/lib/tmdb';
import {
  SECOES, UNIVERSOS, anosDaColecao, carregarColecao, carregarColecoes, colecaoPronta, colecoesLabel, colecoesProntas,
  filmesLabel, idsDe, type Universo, type UniversoId,
} from '@/lib/colecoes';
import MediaCard from './MediaCard';
import { CollectionCard, FileiraDeColecoes, type ColecaoAbrir } from './CollectionCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';

function Cabecalho({ titulo, onBack }: { titulo: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 shrink-0"><ArrowLeft className="w-5 h-5" /></Button>
      <h1 className="text-xl font-bold min-w-0 truncate">{titulo}</h1>
    </div>
  );
}

function Falhou({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-10 text-center space-y-3">
      <p className="text-sm text-muted-foreground">Não deu pra carregar agora.</p>
      <Button variant="outline" onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
}

const Carregando = () => (
  <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
);

// Pasta aberta (pedido dele 01/11/2026): os filmes da coleção na ordem de lançamento, numerados 1..N com o ano.
// Os dados ficam em cache (colecoes.ts): ao voltar de um filme a pasta remonta igual, e o scroll volta pro lugar.
export function CollectionView({ colecao, onOpen, onBack }: { colecao: ColecaoAbrir; onOpen: (m: MediaSummary) => void; onBack: () => void }) {
  const [dados, setDados] = useState<TmdbCollection | null>(() => colecaoPronta(colecao.id) ?? null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setErro(false);
    carregarColecao(colecao.id)
      .then(c => { if (vivo) setDados(c); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [colecao.id]);

  useEffect(() => {
    if (colecaoPronta(colecao.id)) return;
    return carregar();
  }, [colecao.id, carregar]);

  const anos = dados ? anosDaColecao(dados) : '';
  return (
    <div className="space-y-4 animate-fade-in" data-colecao-aberta={colecao.id}>
      <Cabecalho titulo={dados?.name || colecao.nome} onBack={onBack} />
      {dados ? (
        <>
          <div className="space-y-1.5 px-1">
            <p className="text-xs text-muted-foreground">
              {filmesLabel(dados.parts.length)}{anos && ` · ${anos}`} · na ordem de lançamento
            </p>
            {dados.overview && <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{dados.overview}</p>}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {dados.parts.map((m, i) => (
              <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} rank={i + 1} onClick={() => onOpen(m)} />
            ))}
          </div>
        </>
      ) : erro ? (
        <Falhou onRetry={carregar} />
      ) : (
        <Carregando />
      )}
    </div>
  );
}

// W5 (pedido dele 01/11/2026): pasta de um universo aberta — as pastas das sagas da Marvel (ou da DC) numa grade;
// tocar numa abre os filmes dela, como antes. Vão aparecendo de lote em lote.
export function UniversoView({ universo, onOpen, onBack }: { universo: Universo; onOpen: (c: ColecaoAbrir) => void; onBack: () => void }) {
  const ids = useMemo(() => idsDe(universo.colecoes), [universo]);
  const [lista, setLista] = useState<TmdbCollection[] | null>(() => colecoesProntas(ids) ?? null);
  const [completa, setCompleta] = useState(() => !!colecoesProntas(ids));
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setErro(false);
    carregarColecoes(ids, 8, parcial => { if (vivo && parcial.length) setLista(parcial); })
      .then(l => { if (!vivo) return; if (l.length) { setLista(l); setCompleta(true); } else setErro(true); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [ids]);

  useEffect(() => {
    if (colecoesProntas(ids)) return;
    return carregar();
  }, [ids, carregar]);

  return (
    <div className="space-y-4 animate-fade-in" data-universo-aberto={universo.id}>
      <Cabecalho titulo={universo.nome} onBack={onBack} />
      <p className="text-xs text-muted-foreground px-1">{colecoesLabel(universo.colecoes.length)}</p>
      {lista ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {lista.map(c => <CollectionCard key={c.id} colecao={c} onClick={() => onOpen({ id: c.id, nome: c.name })} />)}
          {!completa && !erro && <div className="flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
        </div>
      ) : erro ? (
        <Falhou onRetry={carregar} />
      ) : (
        <Carregando />
      )}
    </div>
  );
}

// "Ver tudo" da fileira: as pastas Marvel e DC e, embaixo, uma fileira por gênero (Ação, Aventura, Ficção…). Cada
// fileira só pede as coleções dela quando chega perto da tela.
export function CollectionsGrid({ onOpen, onOpenUniverso, onBack }: {
  onOpen: (c: ColecaoAbrir) => void; onOpenUniverso: (id: UniversoId) => void; onBack: () => void;
}) {
  return (
    <div className="space-y-6 animate-fade-in" data-colecoes-tudo>
      <Cabecalho titulo="Coleções" onBack={onBack} />
      <FileiraDeColecoes chave="colsec-universos" titulo="Universos" ids={[]} universos={UNIVERSOS}
        onOpen={onOpen} onOpenUniverso={onOpenUniverso} />
      {SECOES.map(s => (
        <FileiraDeColecoes key={s.chave} chave={`colsec-${s.chave}`} titulo={s.nome} ids={idsDe(s.colecoes)}
          onOpen={onOpen} adiar />
      ))}
    </div>
  );
}
