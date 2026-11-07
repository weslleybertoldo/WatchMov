import { memo, useEffect, useRef, useState } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { isTv } from '@/lib/device';
import { depoisDeAssentar, naFilaDoOcioso } from '@/lib/ocioso';
import { guardarFileira, lerFileira, marcarParaAtualizar, pegarParaAtualizar } from '@/lib/fileirasGuardadas';

interface MediaRowProps {
  title: string;
  items?: MediaSummary[];               // pré-carregado (continuar/minha lista)
  loader?: () => Promise<MediaSummary[]>; // carrega sob demanda (TMDB)
  cacheKey?: string;                    // evita refetch ao trocar de aba
  numbered?: boolean;                   // Top 10
  onOpen: (media: MediaSummary) => void;
  onSeeAll?: () => void;
  prioridade?: boolean;                 // 1ª fileira da tela: as capas da frente baixam já (sem esperar o lazy)
  continuar?: boolean;                  // fileira do Continuar assistindo: o segurar oferece o "Remover da lista"
}

// cache simples em memória por cacheKey
const rowCache = new Map<string, MediaSummary[]>();
// W1 do raio-x (02/11/2026): na 1ª montagem da sessão a fileira vem do que ficou guardado no aparelho (fileirasGuardadas):
// aparece na hora, sem "Carregando…". Velha (> 6 h) = a TMDB é consultada depois que a tela assentou e a resposta fica
// guardada pra próxima abertura — nesta sessão a fileira não troca de cartazes com a pessoa olhando.
function daMemoriaOuDoAparelho(cacheKey?: string): MediaSummary[] | undefined {
  if (!cacheKey) return undefined;
  const mem = rowCache.get(cacheKey);
  if (mem) return mem;
  const guardada = lerFileira(cacheKey);
  if (!guardada) return undefined;
  rowCache.set(cacheKey, guardada.itens);
  if (!guardada.fresca) marcarParaAtualizar(cacheKey);
  return guardada.itens;
}
const ESPERA_ATUALIZAR_MS = 4000;     // depois do resto da abertura (avisos, push…), uma fileira por vez no ocioso
const CAPAS_PRIORITARIAS = 6;         // ~as que cabem na largura da tela
// posição do scroll horizontal por linha (sobrevive remontagem ao abrir detalhe)
const scrollCache = new Map<string, number>();
// W4 das quedas na Fire TV (01/11/2026): na TV a aba não monta todos os cartões de uma vez (a Filmes montava ~110 na
// TV de 1 GB e levava ~1,2 s pra aparecer). Monta na hora só a fileira perto da tela; as outras entram no tempo OCIOSO,
// uma por vez e de cima pra baixo, depois que a aba assentou. Medido na Fire TV: montar a fileira só quando a rolagem
// chegava nela pesava a descida (17 × 10 quadros acima de 50 ms), e montar no ocioso logo na troca comia o ganho da troca.
// Até montar fica um espaço do mesmo tamanho (sem pulo). Fileira que já APARECEU na tela fica nesta lista: ao voltar do
// detalhe ela remonta JÁ com os cartões (a âncora do scroll da home não se mexe). A montada só no ocioso não entra: o
// Início e a aba Filmes dividem as fileiras de gênero, e elas chegariam montadas na Filmes (a troca voltava a ~1,1 s).
const fileirasVistas = new Set<string>();
const PERTO_DA_TELA = '600px 0px';   // ~1 tela da TV (540 CSS px) acima e abaixo
const ESPERA_OCIOSO_MS = 1500;       // a aba aparece primeiro; o resto monta depois, antes de a pessoa descer
// W2 do raio-x (02/11/2026): na TV a fileira entra com os cartazes que cabem na largura da tela (960 CSS px ≈ 7,3
// cartazes: o 8º aparece pela metade) e os de trás (+ "Ver mais") entram no tempo ocioso — menos trabalho de uma vez na
// troca de aba. A fileira que já ficou completa remonta completa (o foco volta no cartaz aberto, que pode ser o 10º).
const CARTAZES_DE_ENTRADA_TV = 8;
const fileirasCompletas = new Set<string>();

function MediaRow({ title, items, loader, cacheKey, numbered, onOpen, onSeeAll, prioridade, continuar }: MediaRowProps) {
  // Fileira com a lista pronta (continuar, favoritos) desenha a lista recebida direto; a da TMDB guarda a dela no estado.
  // W2 do raio-x (02/11/2026): antes a lista recebida era copiada pro estado num efeito — cada lista nova desenhava a
  // fileira 2 vezes, a 1ª ainda com a lista velha.
  const [buscada, setBuscada] = useState<MediaSummary[]>(() => (items ? [] : daMemoriaOuDoAparelho(cacheKey) ?? []));
  const data = items ?? buscada;
  const [loading, setLoading] = useState(!items && !(cacheKey && rowCache.has(cacheKey)));
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollKey = cacheKey || title;
  const [perto, setPerto] = useState(() => !isTv() || fileirasVistas.has(scrollKey));
  const [completa, setCompleta] = useState(() => !isTv() || fileirasCompletas.has(scrollKey));

  // TV: chegou perto da tela = vista (monta já, e remonta com os cartões depois). Segue olhando mesmo depois de o ocioso
  // montar a fileira, pra ela virar "vista" quando a pessoa descer até ela.
  useEffect(() => {
    if (!isTv() || fileirasVistas.has(scrollKey)) return;
    const el = rowRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setPerto(true); return; }
    const io = new IntersectionObserver((es) => {
      if (!es.some(e => e.isIntersecting)) return;
      fileirasVistas.add(scrollKey);
      setPerto(true);
      io.disconnect();
    }, { rootMargin: PERTO_DA_TELA });
    io.observe(el);
    return () => io.disconnect();
  }, [scrollKey]);

  // TV: a que não apareceu monta no tempo ocioso, depois que a aba assentou.
  useEffect(() => {
    if (perto) return;
    let desistir = () => {};
    const espera = setTimeout(() => { desistir = naFilaDoOcioso(() => setPerto(true)); }, ESPERA_OCIOSO_MS);
    return () => { clearTimeout(espera); desistir(); };
  }, [perto]);

  // TV: os cartazes de trás entram no ocioso, depois dos da frente (e só depois que a fileira tem os dados). Fileira
  // curta, sem "Ver mais", já entra inteira.
  const faltaCompletar = !completa && (data.length > CARTAZES_DE_ENTRADA_TV || !!onSeeAll);
  useEffect(() => {
    if (!perto || loading || !faltaCompletar) return;
    return naFilaDoOcioso(() => { fileirasCompletas.add(scrollKey); setCompleta(true); });
  }, [perto, loading, faltaCompletar, scrollKey]);

  // Restaura a posição horizontal ao (re)montar com os dados já carregados.
  useEffect(() => {
    if (!loading && perto && scrollRef.current && scrollCache.has(scrollKey)) {
      scrollRef.current.scrollLeft = scrollCache.get(scrollKey)!;
    }
  }, [loading, perto, completa, scrollKey, data.length]);

  useEffect(() => {
    if (items || !loader) return;
    if (cacheKey && rowCache.has(cacheKey)) {
      setBuscada(rowCache.get(cacheKey)!); setLoading(false);
      // Veio velha do aparelho: atualiza o guardado no ocioso (independe desta montagem — a tela pode ter mudado).
      if (pegarParaAtualizar(cacheKey)) {
        depoisDeAssentar(() => { loader().then(res => guardarFileira(cacheKey, res)).catch(() => undefined); }, ESPERA_ATUALIZAR_MS);
      }
      return;
    }
    let alive = true;
    setLoading(true);
    loader()
      .then(res => { if (cacheKey) { rowCache.set(cacheKey, res); guardarFileira(cacheKey, res); } if (!alive) return; setBuscada(res); })
      .catch(() => { if (alive) setBuscada([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, items]);

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  if (!loading && data.length === 0) return null;

  return (
    // data-row-key: âncora do scroll da home — ao voltar do detalhe, a página é
    // recolocada com ESTA linha no mesmo lugar da tela (ver Index.tsx).
    <div ref={rowRef} className="space-y-2" data-row-key={scrollKey}>
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base sm:text-lg font-bold text-foreground">{title}</h2>
        {onSeeAll && (
          // Na TV o "Ver tudo" sai do caminho das setas: o cartão "Ver mais" no fim da fileira faz o mesmo.
          <button onClick={onSeeAll} tabIndex={isTv() ? -1 : undefined} className="text-xs text-muted-foreground hover:text-primary">Ver tudo</button>
        )}
      </div>
      <div className="relative group/row">
        {/* setas desktop (na TV não: o foco do controle já rola a fileira) */}
        {!isTv() && <button onClick={() => scrollBy(-1)} className="hidden md:flex absolute left-0 top-0 bottom-0 z-20 w-8 items-center justify-center bg-gradient-to-r from-background/90 to-transparent opacity-0 group-hover/row:opacity-100 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>}
        <div ref={scrollRef} onScroll={() => { if (scrollRef.current) scrollCache.set(scrollKey, scrollRef.current.scrollLeft); }} className="flex gap-3 overflow-x-auto scroll-smooth snap-x pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {loading ? (
            // W2 do raio-x (02/11/2026): do tamanho de um cartão (a fileira não muda de altura quando chega e a página
            // não pula) e sem o ícone girando (na TV a pulsação também para: index.css).
            <div data-fileira-carregando className="shrink-0 w-28 sm:w-32">
              <div className="rounded-lg bg-muted/40 aspect-[2/3] animate-pulse" />
              <p className="mt-1 text-xs text-muted-foreground">Carregando…</p>
              <div className="text-[10px]">&nbsp;</div>
            </div>
          ) : !perto ? (
            // Espaço do tamanho de um cartão (pôster + título + ano): a fileira entra sem empurrar nada.
            <div data-fileira-reservada aria-hidden="true" className="shrink-0 w-28 sm:w-32">
              <div className="rounded-lg bg-muted/40 aspect-[2/3]" />
              <p className="mt-1 text-xs">&nbsp;</p>
              <div className="text-[10px]">&nbsp;</div>
            </div>
          ) : (
            <>
              {data.slice(0, faltaCompletar ? CARTAZES_DE_ENTRADA_TV : 10).map((m, i) => (
                <div key={`${m.type}-${m.tmdbId}`} className="snap-start">
                  <MediaCard media={m} onOpen={onOpen} rank={numbered ? i + 1 : undefined}
                    prioridade={prioridade && i < CAPAS_PRIORITARIAS} continuar={continuar} />
                </div>
              ))}
              {onSeeAll && !faltaCompletar && (
                <button
                  onClick={onSeeAll}
                  className="shrink-0 w-28 sm:w-32 aspect-[2/3] rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition snap-start"
                >
                  <Plus className="w-7 h-7" />
                  <span className="text-xs mt-1">Ver mais</span>
                </button>
              )}
            </>
          )}
        </div>
        {!isTv() && <button onClick={() => scrollBy(1)} className="hidden md:flex absolute right-0 top-0 bottom-0 z-20 w-8 items-center justify-center bg-gradient-to-l from-background/90 to-transparent opacity-0 group-hover/row:opacity-100 transition">
          <ChevronRight className="w-5 h-5" />
        </button>}
      </div>
    </div>
  );
}

// W2 do raio-x (02/11/2026): a fileira só redesenha quando os dados dela mudam — antes cada redesenho do Index (avisos,
// downloads, biblioteca, login) redesenhava as ~13 fileiras e as ~120 capas do Início. `loader` e `onSeeAll` ficam fora
// da comparação: quem usa passa funções escritas na hora (`() => …`, novas a cada desenho), mas elas só chamam coisas estáveis
// (setState, useCallback) — a fileira usa as do último desenho dela. `onOpen` entra (o Index passa um useCallback).
function mesmaFileira(a: MediaRowProps, b: MediaRowProps): boolean {
  return a.title === b.title && a.items === b.items && a.cacheKey === b.cacheKey && a.numbered === b.numbered
    && a.prioridade === b.prioridade && a.onOpen === b.onOpen && !!a.onSeeAll === !!b.onSeeAll && !!a.continuar === !!b.continuar;
}

export default memo(MediaRow, mesmaFileira);
