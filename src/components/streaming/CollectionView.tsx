import { useCallback, useEffect, useState } from 'react';
import type { MediaSummary, TmdbCollection } from '@/lib/tmdb';
import { COLECOES, anosDaColecao, carregarColecao, carregarColecoes, colecaoPronta, colecoesProntas, filmesLabel } from '@/lib/colecoes';
import MediaCard from './MediaCard';
import { CollectionCard, type ColecaoAbrir } from './CollectionCard';
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
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      )}
    </div>
  );
}

const TODAS = COLECOES.map(c => c.id);

// "Ver tudo" da fileira: todas as pastas numa grade.
export function CollectionsGrid({ onOpen, onBack }: { onOpen: (c: ColecaoAbrir) => void; onBack: () => void }) {
  const [lista, setLista] = useState<TmdbCollection[] | null>(() => colecoesProntas(TODAS) ?? null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setErro(false);
    carregarColecoes(TODAS)
      .then(l => { if (!vivo) return; if (l.length) setLista(l); else setErro(true); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (colecoesProntas(TODAS)) return;
    return carregar();
  }, [carregar]);

  return (
    <div className="space-y-4 animate-fade-in" data-colecoes-tudo>
      <Cabecalho titulo="Coleções" onBack={onBack} />
      {lista ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {lista.map(c => <CollectionCard key={c.id} colecao={c} onClick={() => onOpen({ id: c.id, nome: c.name })} />)}
        </div>
      ) : erro ? (
        <Falhou onRetry={carregar} />
      ) : (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      )}
    </div>
  );
}
