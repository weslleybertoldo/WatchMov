import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, Suspense, type ReactNode } from 'react';
import { useWatchStore } from '@/store/useWatchStore';
import { useAuth } from '@/contexts/AuthContext';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { usePaginaVisivel } from '@/hooks/use-pagina-visivel';
import { WatchItem } from '@/types/watch';
import {
  MediaSummary, trendingWeek, recent, discoverByGenre, discoverAnime, getDetails,
  MOVIE_GENRES, TV_GENRES, ANIME_ROWS, ANIME_GENRES, type TmdbMediaType, type TmdbCollectionRef,
} from '@/lib/tmdb';
import { initPush, loadSubs, onPushOpen } from '@/lib/notifications';
import { getCastNow, closeNativePlayer, playNative, teclaNoPlayer, estadoDoPlayer, type CastNow } from '@/lib/nativePlayer';
import { executarTecla, oQueToca, type AcoesDaTv } from '@/lib/controleNaTv';
import type { TvDevice } from '@/lib/tvPair';
import { Capacitor } from '@capacitor/core';
import { mimeDoLink } from '@/lib/iptvOrg';
import { App as CapApp } from '@capacitor/app';
import { appNaFrente, isTv } from '@/lib/device';
import { listenAsTv, sessionIdOf } from '@/lib/tvRemote';
import { devolverFoco, lembrarCartaz } from '@/lib/tvNav';
import {
  ABAS_GUARDADAS_CELULAR, ABAS_GUARDADAS_TV, MemoriaDeRolagem, TelaVisivel, guardarAba, recolocarRolagem, type Rolagem,
} from '@/lib/telas';
import MediaRow from '@/components/streaming/MediaRow';
import CategoryView from '@/components/streaming/CategoryView';
import Grade from '@/components/streaming/Grade';
import { CollectionRow, type ColecaoAbrir } from '@/components/streaming/CollectionCard';
import { CollectionView, CollectionsGrid, UniversoView } from '@/components/streaming/CollectionView';
import { universoPorId, type UniversoId } from '@/lib/colecoes';
import SearchView, { clearSearchCache } from '@/components/streaming/SearchView';
import MediaCard, { isUpcoming } from '@/components/streaming/MediaCard';
import FavoriteMenu from '@/components/streaming/FavoriteMenu';
import { EsqueletoInicio, EsqueletoTela, EsqueletoTitulo } from '@/components/streaming/Esqueleto';
import { chavesDosFavoritos, ehFavorito, fichaDaBiblioteca, publicarFavoritos, registrarMenuFavorito } from '@/lib/favorites';
import { gravarFavorito } from '@/lib/gravarFavorito';
import { toast } from 'sonner';
import ContinueView from '@/components/streaming/ContinueView';
import type { WatchedStats } from '@/components/streaming/SettingsView';
import { useNotices } from '@/lib/appNotices';
import { startMp4Listener, useMp4All } from '@/lib/mp4Download';
import { startPlaybackErrorLog } from '@/lib/playbackLog';
import { useDownloadList, setWatchedBridge } from '@/lib/downloads';
import HeroCarousel from '@/components/streaming/HeroCarousel';
import type { Channel } from '@/lib/liveTv';
import { continueLabel, continueProgress, totalEpisodesWatched, isEpisodeWatched, sortByLastWatched } from '@/lib/watchProgress';
import UpdateChecker from '@/components/UpdateChecker';
import { fillRow, isPrimaryGenre } from '@/lib/rowFill';
import { depoisDeAssentar } from '@/lib/ocioso';
import { telaSobDemanda } from '@/lib/telaSobDemanda';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Home, Film, Tv, Sparkles, RadioTower, Bookmark, Compass, Search, Settings, ArrowLeft, Bell } from 'lucide-react';

// W1 do raio-x (02/11/2026): fora do JS da abertura — a página do título (com o player e o resolvedor: ~120 kB) baixa
// no ocioso depois que o Início assentou; as telas raras (Painel e as de dentro dele, avisos, Ao Vivo, Procurar)
// baixam quando a pessoa abre.
const MediaDetail = telaSobDemanda(() => import('@/components/streaming/MediaDetail'));
const SettingsView = telaSobDemanda(() => import('@/components/streaming/SettingsView'));
const HistoryView = telaSobDemanda(() => import('@/components/streaming/HistoryView'));
const DownloadView = telaSobDemanda(() => import('@/components/streaming/DownloadView'));
const ServersView = telaSobDemanda(() => import('@/components/streaming/ServersView'));
const TvDevicesView = telaSobDemanda(() => import('@/components/streaming/TvDevicesView'));
const ControleRemotoView = telaSobDemanda(() => import('@/components/streaming/ControleRemotoView'));
const BugsView = telaSobDemanda(() => import('@/components/streaming/BugsView'));
const NoticesView = telaSobDemanda(() => import('@/components/streaming/NoticesView'));
const LiveTvView = telaSobDemanda(() => import('@/components/streaming/LiveTvView'));
const BrowseView = telaSobDemanda(() => import('@/components/streaming/BrowseView'));

type Tab = 'inicio' | 'filmes' | 'series' | 'animes' | 'aovivo' | 'favoritos' | 'procurar';

// Carregando de tela que ainda não baixou (W1 do raio-x). W4 do raio-x (02/11/2026): esqueleto parado do tamanho da tela
// no lugar do spinner (o título tem o dele: fundo, nome e botões).
const CARREGANDO_TELA = <EsqueletoTela />;
const CARREGANDO_TITULO = <EsqueletoTitulo />;

// W3 do raio-x (02/11/2026): uma tela da pilha (aba guardada, tela do meio ou título). Escondida = `hidden` (some da
// página, das setas da TV e do leitor de tela) mas continua montada; cada uma tem o seu Suspense, pra uma tela que ainda
// está baixando não esconder as outras.
// W4 do raio-x (02/11/2026): a tela que aparece (nova, aba trocada ou a de baixo quando o título fecha) entra com o fade
// curto (animate-tela-entra, 180 ms) — o `hidden` → à vista recomeça a animação. Na TV não tem animação (index.css).
function Camada({ tela, escondida, children }: { tela: string; escondida: boolean; children: ReactNode }) {
  return (
    <div data-tela={tela} hidden={escondida} className={escondida ? undefined : 'animate-tela-entra'}>
      <TelaVisivel.Provider value={!escondida}>
        <Suspense fallback={tela.startsWith('titulo:') ? CARREGANDO_TITULO : CARREGANDO_TELA}>{children}</Suspense>
      </TelaVisivel.Provider>
    </div>
  );
}

function itemToSummary(i: WatchItem): MediaSummary {
  return {
    tmdbId: i.tmdbId as number,
    title: i.title,
    posterUrl: i.posterUrl,
    rating: i.rating,
    votes: i.votes,
    type: i.type === 'series' ? 'tv' : 'movie',
  };
}

// Anime = série de animação (gênero "Animação"). Western cartoons também caem aqui.
const isAnime = (i: WatchItem): boolean =>
  i.type === 'series' && /anima[çc][ãa]o|anime/i.test(i.genre || '');

const toCont = (i: WatchItem): MediaSummary => ({ ...itemToSummary(i), subtitle: continueLabel(i), progress: continueProgress(i) ?? undefined });

// O mesmo título espelhando na TV (o nativo devolve um objeto novo a cada 4 s): não troca o estado à toa.
const mesmoCast = (a: CastNow | null, b: CastNow | null): boolean => a === b || (!!a && !!b
  && a.tmdbId === b.tmdbId && a.type === b.type && a.season === b.season && a.episode === b.episode && a.title === b.title);

// W2 do raio-x (02/11/2026): o sino com o número num componente só dele. Os avisos, a lista de downloads (a cada 1,2 s
// enquanto baixa) e as conversões redesenhavam o Index inteiro — e com ele as fileiras e as capas do Início.
// Badge = avisos não lidos + o que está EM ANDAMENTO. Abrir o sino zera os lidos, mas enquanto um download/conversão
// roda o número continua lá — some só quando termina E o aviso de conclusão é visto.
function SinoDoTopo({ aberto, onAbrir }: { aberto: boolean; onAbrir: () => void }) {
  const { unread } = useNotices({ adiarSync: true });
  const { items: downloads } = useDownloadList();
  const dlAtivos = [...downloads.values()].filter(d => d.state === 'downloading' || d.state === 'queued' || d.state === 'restarting').length;
  const mp4Ativos = useMp4All().filter(m => m.state !== 'done').length;
  const badge = unread + dlAtivos + mp4Ativos;
  return (
    <Button variant="ghost" size="icon" className={`relative h-8 w-8 ${aberto ? 'text-primary' : 'text-muted-foreground'}`}
      onClick={onAbrir} title="Notificações">
      <Bell className="w-4 h-4" />
      {badge > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Button>
  );
}

const MOVIE_ROW_IDS = MOVIE_GENRES.map(g => g.id);
const TV_ROW_IDS = TV_GENRES.map(g => g.id);
const ANIME_ROW_IDS = ANIME_GENRES.map(g => g.id);

// Loader de linha de gênero SEM repetição, nas 3 abas: cada título aparece só na sua
// categoria principal (1º gênero dele que tem linha, ordem da TMDB) — evita Superman em
// Ação+Aventura+Ficção e Naruto em Ação+Fantasia.
// Os dois passam pelo `fillRow` (rowFill.ts): busca mais páginas da TMDB enquanto a
// linha não fecha 10 títulos e esconde a que não chega a 5 — nunca completa com título
// de outra categoria.
const animeRowLoader = (rowId: number | null) => () =>
  fillRow(p => discoverAnime(p, rowId), m => rowId == null || isPrimaryGenre(m.genreIds, rowId, ANIME_ROW_IDS));   // "Populares" mostra tudo

const genreRowLoader = (type: TmdbMediaType, genreId: number, rowIds: number[]) => () =>
  fillRow(p => discoverByGenre(type, genreId, p), m => isPrimaryGenre(m.genreIds, genreId, rowIds));

const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'inicio', label: 'Início', icon: Home },
  { key: 'filmes', label: 'Filmes', icon: Film },
  { key: 'series', label: 'Séries', icon: Tv },
  { key: 'animes', label: 'Animes', icon: Sparkles },
  { key: 'aovivo', label: 'Ao Vivo', icon: RadioTower },
  // Favoritos ao lado de Ao Vivo (pedido dele 01/11/2026): era a "Minha Lista" de dentro do Painel.
  { key: 'favoritos', label: 'Favoritos', icon: Bookmark },
  { key: 'procurar', label: 'Procurar', icon: Compass },
];

export default function Index() {
  const { signOut, user, session } = useAuth();
  const store = useWatchStore(user?.id);
  // Episódio BAIXADO abre o player por downloads.ts, fora do VideoPlayer — lá não há
  // store, então o "assistido" que o player devolvia era descartado. Aqui o store fica
  // acessível pra ele aplicar, sempre pela chave que o NATIVO mandou.
  useEffect(() => {
    // `tmdbId:type:season:ep` → item do store. Devolve null quando o título não está
    // na biblioteca (nada a marcar) ou a chave veio malformada.
    const acha = (key: string) => {
      const p = (key || '').split(':');
      const tmdbId = Number(p[0]);
      const kind: 'movie' | 'series' = p[1] === 'movie' ? 'movie' : 'series';
      const item = store.data.items.find(i => i.tmdbId === tmdbId && i.type === kind);
      return item ? { item, kind, season: Number(p[2]), ep: Number(p[3]) } : null;
    };
    setWatchedBridge({
      // Vai JUNTO na abertura do player: sem isto ele nasce achando que o ep não está
      // assistido e, ao fechar, devolveria `false` — desmarcando um ep já marcado.
      get: (key) => {
        const a = acha(key);
        if (!a) return false;
        return a.kind === 'series'
          ? isEpisodeWatched(a.item, a.season, a.ep)
          : !!a.item.completed;
      },
      set: (key, v) => {
        const a = acha(key);
        if (!a) return;
        if (a.kind === 'series') {
          if (a.season && a.ep) store.setEpisodeWatched(a.item.id, a.season, a.ep, v);
          return;
        }
        store.updateItem(a.item.id, v
          ? { completed: true, lastWatchedAt: new Date().toISOString() }
          : { completed: false });
      },
    });
    return () => setWatchedBridge(null);
  }, [store]);

  const [tab, setTab] = useState<Tab>('inicio');
  // W3 do raio-x (02/11/2026): abas montadas (escondidas quando não são a da vez). Início sempre; as outras vistas por
  // último, no máximo ABAS_GUARDADAS_* (TV 1, celular 2).
  const [abasVivas, setAbasVivas] = useState<Tab[]>(['inicio']);
  const [selected, setSelected] = useState<MediaSummary | null>(null);
  const [category, setCategory] = useState<null | { title: string; loadPage: (p: number) => Promise<MediaSummary[]>; cacheKey?: string }>(null);
  // Coleções (pedido dele 01/11/2026): a pasta aberta e a grade do "Ver tudo". Pasta aberta pela página de um
  // filme ("Faz parte da coleção X") guarda o filme: o Voltar da pasta devolve a página do filme, e o Voltar dela, o
  // lugar de onde ele tinha saído (a memória de rolagem da tela de baixo, W3 do raio-x).
  const [colecao, setColecao] = useState<null | (ColecaoAbrir & { origem?: MediaSummary })>(null);
  const [colecoesTudo, setColecoesTudo] = useState(false);
  // W5 (pedido dele 01/11/2026): pasta Marvel/DC aberta (as pastas das sagas do universo). Fica embaixo da pasta da
  // saga aberta de dentro dela: o Voltar da saga devolve o universo, e o do universo, a fileira (ou o "Ver tudo").
  const [universo, setUniverso] = useState<UniversoId | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [continueFilter, setContinueFilter] = useState<null | 'movie' | 'series' | 'anime'>(null);
  const [listFilter, setListFilter] = useState<null | 'movie' | 'series' | 'anime'>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  useEffect(() => { startMp4Listener(); }, []);     // avisos de conversão desde o boot
  // Registro da aba Bugs desde o boot. Antes vivia dentro do VideoPlayer, que
  // episódio BAIXADO nunca monta — então erro de reprodução (e os diagnósticos de
  // cast) daquele caminho se perdiam e a aba vazia parecia "não deu erro".
  // W1 do raio-x: espera a tela assentar (ele lê os fechamentos do app e grava no banco).
  useEffect(() => depoisDeAssentar(() => { startPlaybackErrorLog(); }), []);
  // W1 do raio-x: a página do título baixa no ocioso, antes de a pessoa escolher um título.
  useEffect(() => depoisDeAssentar(() => { void MediaDetail.preparar(); }, 3000), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);    // aba Servidores (favorito do Assistir)
  const [tvOpen, setTvOpen] = useState(false);              // aba Entrar na TV (TVs conectadas + Conectar)
  // Controle remoto (pedido dele 07/11/2026): a lista de TVs e, escolhida uma, o controle dela.
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteTv, setRemoteTv] = useState<TvDevice | null>(null);
  const [bugsOpen, setBugsOpen] = useState(false);
  const [liveChannel, setLiveChannel] = useState<Channel | null>(null); // canal ao vivo tocando
  const [exitAsk, setExitAsk] = useState(false);            // "Deseja sair?" do Voltar na aba Início
  // Menu de segurar a capa (favoritos). O alvo fica guardado depois de fechar pra animação de saída.
  const [menuFavAberto, setMenuFavAberto] = useState(false);
  const [menuFavAlvo, setMenuFavAlvo] = useState<{ media: MediaSummary; favorito: boolean; continuar?: boolean } | null>(null);
  useEffect(() => {
    registrarMenuFavorito((m, origem) => {
      setMenuFavAlvo({ media: m, favorito: ehFavorito(m.type, m.tmdbId), continuar: !!origem.continuar });
      setMenuFavAberto(true);
    });
    return () => registrarMenuFavorito(null);
  }, []);
  // Selo de pastinha nas capas: as chaves dos favoritos saem daqui a cada mudança da biblioteca.
  const bibItems = store.data.items;
  useEffect(() => { publicarFavoritos(chavesDosFavoritos(bibItems)); }, [bibItems]);

  // Push: registra o device e carrega os sinos; tocar na notificação abre o título.
  // W1 do raio-x: o registro e os sinos esperam a tela assentar; o "tocou na notificação" fica já (abre o título).
  useEffect(() => depoisDeAssentar(() => { void initPush(); void loadSubs(); }), []);
  useEffect(() => {
    onPushOpen(({ tmdbId, type }) => {
      getDetails(tmdbId, type === 'tv' ? 'tv' : 'movie')
        .then(d => { setAutoPlay(null); setSelected({ tmdbId, title: d.title, posterUrl: d.posterUrl, type, rating: d.rating, votes: d.votes }); })
        .catch(() => {});
    });
  }, []);

  // Atalho "espelhando na TV": abre o título já dando play no episódio que está na TV.
  // É o ÚNICO caminho que dá play sozinho, e é consumido uma vez: qualquer outro jeito
  // de abrir ou fechar um título zera isso. Antes ficava preso depois do botão Voltar
  // do Android (que só fechava o detalhe), e o PRÓXIMO título aberto pela home abria o
  // servidor sozinho com o episódio errado ("clico na série e o ep abre sozinho").
  const [autoPlay, setAutoPlay] = useState<null | { season: number; episode: number }>(null);
  const closeDetail = useCallback(() => { setAutoPlay(null); setSelected(null); }, []);

  // Lugar da página de cada tela (W3 do raio-x: a memória fica por tela — ver o efeito das camadas, mais abaixo). Além
  // do scrollY, guarda a LINHA (data-row-key) do último toque/OK e a posição dela na tela: a tela pode ter mudado de
  // altura enquanto estava escondida (linha "Continuar assistindo" nova ou reordenada) e restaurar só o scrollY deixava
  // a tela "descendo" pra outro lugar. A âncora só vale logo depois do toque (o que abriu a outra tela).
  const ancoraRef = useRef<{ rowKey: string; rowTop: number; em: number } | null>(null);
  useEffect(() => {
    const marcar = (el: Element | null | undefined) => {
      const f = el?.closest?.('[data-row-key]') as HTMLElement | null | undefined;
      ancoraRef.current = f ? { rowKey: f.dataset.rowKey || '', rowTop: f.getBoundingClientRect().top, em: performance.now() } : null;
    };
    const onDown = (e: Event) => marcar(e.target as Element | null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') marcar(document.activeElement); };   // TV: o OK
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, []);
  const openMedia = useCallback((m: MediaSummary) => {
    setAutoPlay(null);
    setSelected(m);
  }, []);

  // O que está espelhando na TV agora (o estado vive no nativo e sobrevive ao
  // fechar o player) → atalho no topo pra voltar pro episódio que está na TV.
  const [castNow, setCastNow] = useState<CastNow | null>(null);
  const [, setTvProgress] = useState(0);   // tempo da TV gravado no "continuar" → redesenha a tela do título
  // Na TV não tem espelhar (o vídeo já está na tela grande): nada pra perguntar a cada 4 s. Com o player nativo por cima
  // ou o app no fundo a página fica escondida → para; ao voltar, pergunta na hora (estudo do Nuvio, item 7, 20/10/2026).
  const paginaVisivel = usePaginaVisivel();
  useEffect(() => {
    if (isTv() || !paginaVisivel) return;
    let alive = true;
    const tick = () => {
      getCastNow().then(({ now, progressed }) => {
        if (!alive) return;
        setCastNow(prev => (mesmoCast(prev, now) ? prev : now));
        if (progressed) setTvProgress(n => n + 1);
      }).catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, [paginaVisivel]);

  // Toca no atalho: abre o título que está na TV já no episódio espelhado — é o
  // mesmo caminho de clicar no episódio, então o player reassume os controles.
  const openCastNow = useCallback(() => {
    if (!castNow) return;
    getDetails(castNow.tmdbId, castNow.type)
      .then(d => {
        setAutoPlay(castNow.type === 'tv' && castNow.episode > 0
          ? { season: castNow.season, episode: castNow.episode } : null);
        setSelected({ tmdbId: castNow.tmdbId, title: d.title, posterUrl: d.posterUrl,
          type: castNow.type, rating: d.rating, votes: d.votes });
      })
      .catch(() => {});
  }, [castNow]);
  // "Ver tudo" (categoria / continuar assistindo), Coleções, título: a tela nova nasce no TOPO e, no Voltar, a de onde
  // saiu volta pro mesmo lugar (a LINHA de onde saiu; pedido 07/09/2026). Desde a W3 do raio-x quem cuida disso é a
  // memória de rolagem por tela, no efeito das camadas (mais abaixo) — aqui só se abre e fecha.
  const openCategory = useCallback((c: NonNullable<typeof category>) => setCategory(c), []);
  // Canal ao vivo: os do iptv-org (link direto, 03/11/2026) tocam no player nativo com referer/user-agent da lista;
  // no navegador e nos do SuperFlix (iframe) abre a camada de sempre.
  const abrirCanal = useCallback((ch: Channel) => {
    if (ch.url && Capacitor.isNativePlatform()) {
      void playNative({ url: ch.url, referer: ch.referer, ua: ch.ua, mime: mimeDoLink(ch.url), title: ch.name });
      return;
    }
    setLiveChannel(ch);
  }, []);
  const openContinue = useCallback((f: 'movie' | 'series' | 'anime') => setContinueFilter(f), []);
  const openGenre = (type: TmdbMediaType, id: number, name: string) =>
    openCategory({ title: name, loadPage: (p) => discoverByGenre(type, id, p), cacheKey: `cat-${type}-${id}` });

  // Coleções: pasta, universo e grade (a pasta pode ficar por cima do universo, e os dois por cima da grade).
  const openColecao = useCallback((c: ColecaoAbrir) => setColecao({ id: c.id, nome: c.nome }), []);
  const openUniverso = useCallback((u: UniversoId) => setUniverso(u), []);
  const openColecoesTudo = useCallback(() => setColecoesTudo(true), []);
  const openColecaoDoFilme = useCallback((c: TmdbCollectionRef) => {
    if (!selected) return;
    // O filme foi aberto DESTA pasta (ela está embaixo): é só voltar pra ela, no mesmo lugar.
    if (colecao?.id === c.id) { closeDetail(); return; }
    setColecao({ id: c.id, nome: c.name, origem: selected });
    closeDetail();
  }, [selected, colecao, closeDetail]);
  const fecharColecao = useCallback(() => {
    if (!colecao) return;
    if (colecao.origem) {
      setAutoPlay(null);
      setSelected(colecao.origem);
    } else {
      lembrarCartaz(`col-${colecao.id}`);   // TV: o foco volta na pasta de onde ele entrou
    }
    setColecao(null);
  }, [colecao]);
  const fecharUniverso = useCallback(() => {
    if (!universo) return;
    lembrarCartaz(`uni-${universo}`);   // TV: o foco volta na pasta Marvel/DC
    setUniverso(null);
  }, [universo]);
  const fecharColecoesTudo = useCallback(() => setColecoesTudo(false), []);

  const handleBack = useCallback(async (): Promise<boolean> => {
    if (menuFavAberto) { setMenuFavAberto(false); return true; }
    if (exitAsk) { setExitAsk(false); return true; }
    if (liveChannel) { setLiveChannel(null); return true; }
    if (selected) { closeDetail(); return true; }
    if (colecao) { fecharColecao(); return true; }
    if (universo) { fecharUniverso(); return true; }
    if (colecoesTudo) { fecharColecoesTudo(); return true; }
    if (historyOpen) { setHistoryOpen(false); return true; }
    if (downloadOpen) { setDownloadOpen(false); return true; }
    if (serversOpen) { setServersOpen(false); return true; }
    if (tvOpen) { setTvOpen(false); return true; }
    if (remoteTv) { setRemoteTv(null); return true; }
    if (remoteOpen) { setRemoteOpen(false); return true; }
    if (bugsOpen) { setBugsOpen(false); return true; }
    if (listFilter) { setListFilter(null); return true; }
    if (noticesOpen) { setNoticesOpen(false); return true; }
    if (settingsOpen) { setSettingsOpen(false); return true; }
    if (searchOpen) { setSearchOpen(false); clearSearchCache(); return true; }
    if (continueFilter) { setContinueFilter(null); return true; }
    if (category) { setCategory(null); return true; }
    if (tab !== 'inicio') { setTab('inicio'); return true; }
    // Aba Início sem nada aberto: antes saía direto (pedido dele 26/09/2026: perguntar "Deseja sair?").
    setExitAsk(true);
    return true;
  }, [menuFavAberto, exitAsk, liveChannel, selected, closeDetail, historyOpen, downloadOpen, serversOpen, tvOpen, remoteTv, remoteOpen, bugsOpen, settingsOpen, noticesOpen, searchOpen, continueFilter, listFilter, colecao, universo, colecoesTudo, fecharColecao, fecharUniverso, fecharColecoesTudo, category, tab]);
  useAndroidBackButton(handleBack);

  // TV: o celular mandou abrir um título (enviar pra TV). Fecha o que estiver por cima e mostra a página dele.
  const openFromRemote = useCallback((m: MediaSummary) => {
    setExitAsk(false); setLiveChannel(null); setSettingsOpen(false); setNoticesOpen(false); setHistoryOpen(false);
    setDownloadOpen(false); setServersOpen(false); setTvOpen(false); setBugsOpen(false);
    setMenuFavAberto(false); setListFilter(null); setSearchOpen(false); clearSearchCache(); setContinueFilter(null); setCategory(null);
    setColecao(null); setUniverso(null); setColecoesTudo(false);
    setAutoPlay(null);
    setSelected(m);
  }, []);
  const acoesDaTv: AcoesDaTv = {
    teclaNoPlayer, estadoDoPlayer, fecharPlayer: closeNativePlayer,
    voltar: () => handleBack(),
    inicio: () => changeTab('inicio'),
    capa: () => selected?.posterUrl,
  };
  const acoesDaTvRef = useRef(acoesDaTv);
  acoesDaTvRef.current = acoesDaTv;
  const openFromRemoteRef = useRef(openFromRemote);
  openFromRemoteRef.current = openFromRemote;
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  // Pedidos do celular pelo canal da conta. Só atende com o app na frente (senão o celular avisa que a TV está
  // desligada); com o player nativo tocando, fecha ele antes (salva a posição, como o Voltar).
  const tvSid = isTv() ? sessionIdOf(session?.access_token) : null;
  const uid = user?.id;
  useEffect(() => {
    if (!tvSid || !uid) return;
    return listenAsTv(uid, tvSid, async (cmd) => {
      if (cmd.action === 'logout') { void signOutRef.current(); return true; }
      if (!(await appNaFrente())) return false;
      if (await closeNativePlayer()) await new Promise(r => setTimeout(r, 600));
      openFromRemoteRef.current(cmd.media);
      return true;
    }, async (ctl) => {
      // Controle remoto do celular: só com o WatchMov na frente (no fundo o celular mostra "não respondeu").
      if (!(await appNaFrente())) return false;
      if (ctl.action === 'key') await executarTecla(ctl.key, acoesDaTvRef.current);
      return { tocando: await oQueToca(acoesDaTvRef.current) };
    });
  }, [tvSid, uid]);

  // W2 do raio-x (02/11/2026): as listas das fileiras (e as contas do Painel) só são refeitas quando a biblioteca muda —
  // listas novas a cada desenho faziam as fileiras (memo) redesenharem todas as capas.
  const continueAll = useMemo(() => store.continueWatching.filter(i => i.tmdbId), [store.continueWatching]);
  const { continueMovies, continueAnimes, continueSeries } = useMemo(() => ({
    continueMovies: continueAll.filter(i => i.type === 'movie').map(toCont),
    continueAnimes: continueAll.filter(isAnime).map(toCont),
    continueSeries: continueAll.filter(i => i.type === 'series' && !isAnime(i)).map(toCont),
  }), [continueAll]);
  const { listMovies, listAnimes, listSeries } = useMemo(() => {
    const salvos = store.myList.filter(i => i.tmdbId);
    return {
      listMovies: salvos.filter(i => i.type === 'movie').map(itemToSummary),
      listAnimes: salvos.filter(isAnime).map(itemToSummary),
      listSeries: salvos.filter(i => i.type === 'series' && !isAnime(i)).map(itemToSummary),
    };
  }, [store.myList]);
  // ── Assistidos (painel + histórico) ──
  // Filme: marcado como concluído. Série/anime: ≥1 episódio marcado. O último assistido primeiro.
  const { watchedStats, histMovies, histSeries, histAnimes } = useMemo(() => {
    const watchedItems = sortByLastWatched(store.data.items.filter(i => i.tmdbId &&
      (i.type === 'movie' ? !!i.completed : totalEpisodesWatched(i) > 0)));
    const watchedMovies = watchedItems.filter(i => i.type === 'movie');
    const watchedAnimes = watchedItems.filter(isAnime);
    const watchedSeries = watchedItems.filter(i => i.type === 'series' && !isAnime(i));
    const sumEps = (arr: WatchItem[]) => arr.reduce((n, i) => n + totalEpisodesWatched(i), 0);
    const stats: WatchedStats = {
      moviesCount: watchedMovies.length,
      seriesCount: watchedSeries.length,
      seriesEpisodes: sumEps(watchedSeries),
      animesCount: watchedAnimes.length,
      animeEpisodes: sumEps(watchedAnimes),
    };
    return {
      watchedStats: stats,
      histMovies: watchedMovies.map(itemToSummary),
      histSeries: watchedSeries.map(itemToSummary),
      histAnimes: watchedAnimes.map(itemToSummary),
    };
  }, [store.data.items]);

  // ── W3 do raio-x (02/11/2026): as telas em camadas ──
  // A pilha do que está aberto, de baixo pra cima: a aba → as telas do meio (Ver tudo, busca, Painel, avisos, Coleções…;
  // a última é a que aparece) → o título. Só a de cima aparece; ficam montadas e escondidas as abas guardadas e a tela do
  // meio de cima (embaixo do título). Voltar pra uma delas é só mostrar de novo.
  const telaAba = `aba:${tab}`;
  const meio: string[] = [];
  if (category) meio.push(`categoria:${category.cacheKey ?? category.title}`);
  if (continueFilter) meio.push(`continuar:${continueFilter}`);
  if (searchOpen) meio.push('busca');
  if (settingsOpen) {
    meio.push('painel');
    const sub = historyOpen ? 'historico' : downloadOpen ? 'downloads' : serversOpen ? 'servidores' : tvOpen ? 'tvs' : remoteOpen ? 'controle' : bugsOpen ? 'bugs' : '';
    if (sub) meio.push(`painel:${sub}`);
  }
  if (noticesOpen) meio.push('avisos');
  if (colecoesTudo) meio.push('colecoes');
  if (universo && universoPorId(universo)) meio.push(`universo:${universo}`);
  if (colecao) meio.push(`colecao:${colecao.id}`);
  const telaMeio = meio.length ? meio[meio.length - 1] : null;
  const telaTitulo = selected ? `titulo:${selected.type}-${selected.tmdbId}` : null;
  const telaVisivel = telaTitulo ?? telaMeio ?? telaAba;
  const telasMontadas = [...abasVivas.map(a => `aba:${a}`), ...(telaMeio ? [telaMeio] : []), ...(telaTitulo ? [telaTitulo] : [])].join('|');
  // Memória de rolagem: das telas que ainda podem reaparecer (a aba, as abas guardadas, as do meio abertas).
  const telasGuardaveis = [telaAba, ...abasVivas.map(a => `aba:${a}`), ...meio].join('|');

  // A página inteira rola (window): cada tela guarda onde estava quando outra foi por cima e recebe de volta quando
  // reaparece; a que nunca foi coberta nasce no topo. O "onde estava" é o último scroll da tela à vista (ouvido na
  // rolagem — depois da troca a altura da página já é a da outra tela) + a âncora do toque/OK que abriu a outra.
  const memoriaRef = useRef<MemoriaDeRolagem | null>(null);
  if (!memoriaRef.current) memoriaRef.current = new MemoriaDeRolagem();
  const yDaTela = useRef(0);
  const telaAnterior = useRef<string | null>(null);
  const montadasAntes = useRef<Set<string>>(new Set());
  const cancelarRecolocar = useRef<() => void>(() => undefined);
  useEffect(() => {
    yDaTela.current = window.scrollY;
    const onScroll = () => { yDaTela.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (store.loading) return;
    const memoria = memoriaRef.current!;
    const antes = telaAnterior.current;
    const estavaMontada = montadasAntes.current.has(telaVisivel);
    telaAnterior.current = telaVisivel;
    montadasAntes.current = new Set(telasMontadas.split('|'));
    if (antes === null || antes === telaVisivel) { memoria.manterSo(telasGuardaveis.split('|')); return; }
    const a = ancoraRef.current;
    memoria.guardar(antes, { y: yDaTela.current, ...(a && performance.now() - a.em < 2000 ? { rowKey: a.rowKey, rowTop: a.rowTop } : {}) });
    memoria.manterSo(telasGuardaveis.split('|'));
    cancelarRecolocar.current();
    const pos: Rolagem | undefined = memoria.ler(telaVisivel);
    if (pos) cancelarRecolocar.current = recolocarRolagem(pos);
    else { cancelarRecolocar.current = () => undefined; window.scrollTo(0, 0); }
    yDaTela.current = window.scrollY;
    // TV: a tela que estava guardada voltou já pronta → o foco vai JÁ pro cartaz aberto (se o foco se perdeu). Tela nova
    // fica com o observador do tvNav, que espera ela carregar (ex.: o "Assistir" do título).
    if (estavaMontada && isTv()) devolverFoco();
  }, [telaVisivel, telasMontadas, telasGuardaveis, store.loading]);

  // W4 do raio-x: 1ª abertura sem a biblioteca guardada = a casca do app em esqueleto, não um spinner de tela cheia.
  if (store.loading) return <EsqueletoInicio />;
  // W1 do raio-x: a 1ª fileira do Início baixa as capas da frente já (as outras seguem no lazy).
  const primeiraDoInicio = continueMovies.length ? 'cf' : continueSeries.length ? 'cs' : continueAnimes.length ? 'ca' : 'top10';
  const continueFiltered = continueFilter === 'movie' ? continueAll.filter(i => i.type === 'movie')
    : continueFilter === 'anime' ? continueAll.filter(isAnime)
    : continueFilter === 'series' ? continueAll.filter(i => i.type === 'series' && !isAnime(i))
    : continueAll;
  const continueEntries = continueFiltered.map(i => ({ id: i.id, summary: toCont(i) }));
  const continueTitle = continueFilter === 'movie' ? 'Continuar assistindo seus filmes'
    : continueFilter === 'anime' ? 'Continuar assistindo seus animes'
    : continueFilter === 'series' ? 'Continuar assistindo suas séries'
    : 'Continuar assistindo';
  const listFiltered = listFilter === 'movie' ? listMovies : listFilter === 'anime' ? listAnimes : listFilter === 'series' ? listSeries : [];
  const listTitle = listFilter === 'movie' ? 'Filmes' : listFilter === 'anime' ? 'Animes' : 'Séries';

  // W3 do raio-x: a aba vista há pouco continua montada (guardarAba) e, no celular, volta onde estava. A mesma aba de novo
  // nasce no topo; na TV também a outra (o foco está na barra de cima, que leva a página pro topo).
  const changeTab = (t: Tab) => {
    if (t === tab || isTv()) memoriaRef.current!.esquecer(`aba:${t}`);
    if (t === tab && telaVisivel === telaAba) window.scrollTo(0, 0);   // já na aba, sem nada por cima: só sobe
    setAbasVivas(v => guardarAba(v, t, 'inicio', isTv() ? ABAS_GUARDADAS_TV : ABAS_GUARDADAS_CELULAR));
    setTab(t); closeDetail(); setCategory(null); setSearchOpen(false); clearSearchCache(); setContinueFilter(null); setListFilter(null); setSettingsOpen(false); setHistoryOpen(false); setDownloadOpen(false); setServersOpen(false); setTvOpen(false); setRemoteOpen(false); setRemoteTv(null); setBugsOpen(false); setNoticesOpen(false); setLiveChannel(null); setColecao(null); setUniverso(null); setColecoesTudo(false);
  };

  // Lupa, sino e engrenagem (pedido dele 27/09/2026): de qualquer tela abrem a tela deles, sem liga/desliga — antes
  // eram interruptores e a lupa nem aparecia com um título, os avisos ou o Painel por cima. A engrenagem sempre cai
  // na tela principal do Painel (não no Histórico/Downloads onde ele parou).
  const abrirDoTopo = (alvo: 'busca' | 'avisos' | 'painel') => {
    closeDetail(); setCategory(null); setColecao(null); setUniverso(null); setColecoesTudo(false);
    setSearchOpen(alvo === 'busca'); setNoticesOpen(alvo === 'avisos'); setSettingsOpen(alvo === 'painel');
    setHistoryOpen(false); setDownloadOpen(false); setServersOpen(false); setTvOpen(false); setRemoteOpen(false); setRemoteTv(null); setBugsOpen(false); setListFilter(null);
  };
  // Menu de segurar a capa → põe/tira dos favoritos. Título que ainda não está na biblioteca ganha a ficha completa
  // da TMDB (o gênero separa Séries de Animes; as temporadas), igual ao botão de pastinha da página dele.
  // W4 do raio-x (02/11/2026): o aviso sai NA HORA do OK (estado otimista) — antes ele esperava a TMDB e o banco (título
  // fora da biblioteca: 0,3–0,8 s no celular). Deu erro → o aviso de erro troca o de sucesso.
  // "Remover da lista" (pedido dele 07/11/2026): sai do Continuar assistindo e volta sozinho quando ele assistir de novo;
  // o progresso e os episódios marcados ficam como estão.
  const removerDoContinuar = (m: MediaSummary) => {
    const tipo: 'movie' | 'series' = m.type === 'tv' ? 'series' : 'movie';
    const item = store.data.items.find(i => i.tmdbId === m.tmdbId && i.type === tipo);
    if (!item) return;
    void store.updateItem(item.id, { continueHiddenAt: new Date().toISOString() });
    toast.success('Removido do Continuar assistindo');
  };

  const alternarFavorito = async (m: MediaSummary, favoritar: boolean) => {
    const aviso = toast.success(favoritar ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
    const tipo: 'movie' | 'series' = m.type === 'tv' ? 'series' : 'movie';
    let item = store.data.items.find(i => i.tmdbId === m.tmdbId && i.type === tipo) ?? null;
    const precisaDetalhes = !item || (favoritar && m.type === 'movie' && !m.date);   // filme: a data decide o sino
    const detalhes = precisaDetalhes ? await getDetails(m.tmdbId, m.type).catch(() => null) : null;
    if (!item) item = await store.upsertLibraryItem(fichaDaBiblioteca(m, detalhes));
    if (!item) { toast.error('Não deu pra salvar agora. Tente de novo.', { id: aviso }); return; }
    gravarFavorito(store.updateItem, item, favoritar, {
      tmdbId: m.tmdbId, type: m.type, title: item.title, posterUrl: item.posterUrl ?? m.posterUrl,
      emBreve: isUpcoming(m.date ?? detalhes?.releaseDate),
    });
  };

  // Busca já na tela: a lupa leva pro campo (na TV o OK solto nele abre o teclado do Fire TV).
  const abrirBusca = () => {
    if (telaVisivel === 'busca') document.querySelector<HTMLInputElement>('[data-tela="busca"] input[type="search"]')?.focus();
    else abrirDoTopo('busca');
  };

  // As telas do meio, da de cima pra de baixo (a mesma ordem da pilha `meio`).
  const conteudoDoMeio = (): ReactNode => (
    colecao ? (
      /* Pasta e grade logo depois do detalhe: a pasta aberta pela página de um filme (que pode ter vindo da
         busca, do histórico…) aparece por cima da tela de onde o filme saiu, e o Voltar devolve tudo em ordem. */
      <CollectionView key={colecao.id} colecao={colecao} onOpen={openMedia} onBack={fecharColecao} />
    ) : universo && universoPorId(universo) ? (
      <UniversoView key={universo} universo={universoPorId(universo)!} onOpen={openColecao} onBack={fecharUniverso} />
    ) : colecoesTudo ? (
      <CollectionsGrid onOpen={openColecao} onOpenUniverso={openUniverso} onBack={fecharColecoesTudo} />
    ) : noticesOpen ? (
      <NoticesView onBack={() => setNoticesOpen(false)} />
    ) : settingsOpen ? (
      historyOpen ? (
        <HistoryView movies={histMovies} series={histSeries} animes={histAnimes} onOpen={openMedia} onBack={() => setHistoryOpen(false)} />
      ) : downloadOpen ? (
        <DownloadView onBack={() => setDownloadOpen(false)} />
      ) : serversOpen ? (
        <ServersView onBack={() => setServersOpen(false)} />
      ) : tvOpen ? (
        <TvDevicesView onBack={() => setTvOpen(false)} />
      ) : remoteOpen ? (
        <ControleRemotoView tv={remoteTv} onEscolherTv={setRemoteTv} onBack={() => setRemoteOpen(false)}
          onConectarTv={() => { setRemoteOpen(false); setTvOpen(true); }} />
      ) : bugsOpen ? (
        <BugsView onBack={() => setBugsOpen(false)} />
      ) : (
        <SettingsView stats={watchedStats} onHistory={() => setHistoryOpen(true)} onDownload={() => setDownloadOpen(true)} onServers={() => setServersOpen(true)} onBugs={() => setBugsOpen(true)} onTv={() => setTvOpen(true)} onRemote={() => setRemoteOpen(true)} onSignOut={signOut} onBack={() => setSettingsOpen(false)} />
      )
    ) : searchOpen ? (
      <SearchView onOpen={openMedia} />
    ) : continueFilter ? (
      <ContinueView title={continueTitle} entries={continueEntries} onOpen={openMedia} onRemove={store.clearProgress} onBack={() => setContinueFilter(null)} />
    ) : category ? (
      <CategoryView title={category.title} loadPage={category.loadPage} cacheKey={category.cacheKey} onOpen={openMedia} onBack={() => setCategory(null)} />
    ) : null
  );

  const conteudoDaAba = (t: Tab): ReactNode => (
    t === 'inicio' ? (
      <div className="space-y-6">
        <HeroCarousel onOpen={openMedia} />
        {continueMovies.length > 0 && (
          <MediaRow continuar title="Continuar assistindo seus filmes" items={continueMovies} onOpen={openMedia} onSeeAll={() => openContinue('movie')} prioridade={primeiraDoInicio === 'cf'} />
        )}
        {continueSeries.length > 0 && (
          <MediaRow continuar title="Continuar assistindo suas séries" items={continueSeries} onOpen={openMedia} onSeeAll={() => openContinue('series')} prioridade={primeiraDoInicio === 'cs'} />
        )}
        {continueAnimes.length > 0 && (
          <MediaRow continuar title="Continuar assistindo seus animes" items={continueAnimes} onOpen={openMedia} onSeeAll={() => openContinue('anime')} prioridade={primeiraDoInicio === 'ca'} />
        )}
        <MediaRow title="🔥 Top 10 da semana" numbered cacheKey="top10-movie"
          loader={() => trendingWeek('movie')} onOpen={openMedia} prioridade={primeiraDoInicio === 'top10'} />
        <MediaRow title="Top 10 séries" numbered cacheKey="top10-tv"
          loader={() => trendingWeek('tv')} onOpen={openMedia} />
        <MediaRow title="Lançamentos recentes" cacheKey="recent-movie"
          loader={() => recent('movie')} onOpen={openMedia}
          onSeeAll={() => openCategory({ title: 'Lançamentos recentes', loadPage: (p) => recent('movie', p), cacheKey: 'cat-recent-movie' })} />
        {MOVIE_GENRES.slice(0, 6).map(g => (
          <MediaRow key={g.id} title={g.name} cacheKey={`m-${g.id}`}
            loader={genreRowLoader('movie', g.id, MOVIE_ROW_IDS)} onOpen={openMedia}
            onSeeAll={() => openGenre('movie', g.id, g.name)} />
        ))}
        <footer className="pt-4 border-t border-border/50">
          <UpdateChecker />
        </footer>
      </div>
    ) : t === 'filmes' ? (
      <div className="space-y-6">
        <CollectionRow onOpen={openColecao} onOpenUniverso={openUniverso} onSeeAll={openColecoesTudo} />
        {/* Top 10 da semana também aqui, logo abaixo de Coleções (pedido dele 01/11/2026); o mesmo cache do Início. */}
        <MediaRow title="🔥 Top 10 da semana" numbered cacheKey="top10-movie"
          loader={() => trendingWeek('movie')} onOpen={openMedia} prioridade />
        {MOVIE_GENRES.map(g => (
          <MediaRow key={g.id} title={g.name} cacheKey={`m-${g.id}`}
            loader={genreRowLoader('movie', g.id, MOVIE_ROW_IDS)} onOpen={openMedia}
            onSeeAll={() => openGenre('movie', g.id, g.name)} />
        ))}
      </div>
    ) : t === 'series' ? (
      <div className="space-y-6">
        {/* Top 10 de séries também na aba Séries, no topo (pedido dele 01/11/2026); o mesmo cache do Início. */}
        <MediaRow title="Top 10 séries" numbered cacheKey="top10-tv"
          loader={() => trendingWeek('tv')} onOpen={openMedia} prioridade />
        {TV_GENRES.map(g => (
          <MediaRow key={g.id} title={g.name} cacheKey={`t-${g.id}`}
            loader={genreRowLoader('tv', g.id, TV_ROW_IDS)} onOpen={openMedia}
            onSeeAll={() => openGenre('tv', g.id, g.name)} />
        ))}
      </div>
    ) : t === 'animes' ? (
      <div className="space-y-6">
        {ANIME_ROWS.map((r, k) => (
          <MediaRow key={r.name} title={r.name} cacheKey={`a-${r.id ?? 'pop'}`}
            loader={animeRowLoader(r.id)} onOpen={openMedia} prioridade={k === 0}
            onSeeAll={() => openCategory({ title: r.name, loadPage: (p) => discoverAnime(p, r.id), cacheKey: `cat-anime-${r.id ?? 'pop'}` })} />
        ))}
      </div>
    ) : t === 'favoritos' ? (
      <div className="space-y-6">
        {listFilter ? (
          <>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setListFilter(null)}><ArrowLeft className="w-5 h-5" /></Button>
              <h1 className="text-xl font-bold">{listTitle}</h1>
            </div>
            {/* W5 do raio-x (02/11/2026): na TV só as linhas perto do foco ficam montadas (Grade). */}
            <Grade itens={listFiltered} chave={m => `${m.type}-${m.tmdbId}`}>
              {m => <MediaCard media={m} onOpen={openMedia} />}
            </Grade>
          </>
        ) : (listMovies.length === 0 && listSeries.length === 0 && listAnimes.length === 0) ? (
          <div className="py-12 text-center space-y-2">
            <Bookmark className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum favorito ainda.</p>
            <p className="text-xs text-muted-foreground">Segure a capa de um filme ou série pra salvar aqui (na TV, segure o OK).</p>
          </div>
        ) : (
          <>
            {listMovies.length > 0 && <MediaRow title="Filmes" items={listMovies} onOpen={openMedia} onSeeAll={() => setListFilter('movie')} />}
            {listSeries.length > 0 && <MediaRow title="Séries" items={listSeries} onOpen={openMedia} onSeeAll={() => setListFilter('series')} />}
            {listAnimes.length > 0 && <MediaRow title="Animes" items={listAnimes} onOpen={openMedia} onSeeAll={() => setListFilter('anime')} />}
          </>
        )}
      </div>
    ) : t === 'procurar' ? (
      <BrowseView onOpen={openMedia} />
    ) : (
      <LiveTvView onPlay={abrirCanal} />
    )
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      {/* W2 do raio-x (02/11/2026): sem desfoque (no celular ele refazia o fundo a cada quadro da rolagem) e com o fundo cheio
          (translúcido sem desfoque, o texto de baixo aparecia fraquinho por trás). */}
      <header className="sticky top-0 z-40 bg-background border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/logo-topo.png" alt="WatchMov" width={28} height={28} className="h-7 w-7 cursor-pointer" onClick={() => changeTab('inicio')} />
          {castNow && (
            <button onClick={openCastNow} title="Abrir o que está na TV"
              className="flex-1 mx-2 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/15 text-primary">
              <Tv className="w-4 h-4 shrink-0" />
              <span className="text-xs truncate">{castNow.title || 'Espelhando na TV'}</span>
            </button>
          )}
          <nav className="hidden sm:flex items-center gap-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => changeTab(t.key)}
                className={`toque px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === t.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className={`h-8 w-8 ${searchOpen ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={abrirBusca} title="Buscar">
              <Search className="w-4 h-4" />
            </Button>
            <SinoDoTopo aberto={noticesOpen} onAbrir={() => abrirDoTopo('avisos')} />
            <Button variant="ghost" size="icon" className={`h-8 w-8 ${settingsOpen ? 'text-primary' : 'text-muted-foreground'}`} onClick={() => abrirDoTopo('painel')} title="Painel">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Player de canal ao vivo — overlay full-screen (iframe modo servidor; iptv-org no navegador = <video>). */}
      {liveChannel && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center gap-2 px-3 h-12 bg-black/90 text-white shrink-0">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white hover:bg-white/10" onClick={() => setLiveChannel(null)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <span className="text-sm font-medium truncate">{liveChannel.name}</span>
          </div>
          {liveChannel.url ? (
            /* iptv-org no navegador: <video> direto (toca onde o navegador lê HLS; no app vai pro player nativo). */
            <video key={liveChannel.url} src={liveChannel.url} title={liveChannel.name}
              className="flex-1 w-full min-h-0 bg-black" controls autoPlay playsInline />
          ) : (
            <iframe key={liveChannel.embed} src={liveChannel.embed} title={liveChannel.name}
              className="flex-1 w-full border-0"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen referrerPolicy="origin" />
          )}
        </div>
      )}

      {/* Conteúdo — W3 do raio-x (02/11/2026): em camadas. As abas guardadas e a tela do meio embaixo do título ficam
          montadas e escondidas; só a de cima aparece (telaVisivel). */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-6 py-4 pb-24 sm:pb-6">
        {abasVivas.map(t => (
          <Camada key={`aba:${t}`} tela={`aba:${t}`} escondida={telaVisivel !== `aba:${t}`}>
            {conteudoDaAba(t)}
          </Camada>
        ))}
        {telaMeio && (
          <Camada key={telaMeio} tela={telaMeio} escondida={!!telaTitulo}>
            {conteudoDoMeio()}
          </Camada>
        )}
        {selected && telaTitulo && (
          <Camada key={telaTitulo} tela={telaTitulo} escondida={false}>
            {/* key por título: trocar de título (relacionados) REMONTA o detalhe — estado
                do título anterior (ficha, temporada, aba de episódios, autoPlay já usado)
                não vaza pro novo. */}
            <MediaDetail key={`${selected.type}-${selected.tmdbId}`} media={selected} store={store} autoPlay={autoPlay} castNow={castNow}
              onBack={closeDetail} onOpenCollection={openColecaoDoFilme}
              /* Relacionado NÃO passa pelo openMedia (que é de quem abre da lista); a tela nova nasce no topo. */
              onOpen={(m) => { setAutoPlay(null); setSelected(m); }} />
          </Camada>
        )}
      </main>

      <AlertDialog open={exitAsk} onOpenChange={setExitAsk}>
        <AlertDialogContent className="max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja sair?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:justify-center">
            <AlertDialogCancel className="flex-1 mt-0" data-tv-autofocus>Não</AlertDialogCancel>
            <AlertDialogAction className="flex-1" onClick={() => { CapApp.exitApp().catch(() => undefined); }}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FavoriteMenu aberto={menuFavAberto} alvo={menuFavAlvo} onFechar={() => setMenuFavAberto(false)}
        onAlternar={(m, favoritar) => { void alternarFavorito(m, favoritar); }}
        onRemoverDaLista={removerDoContinuar} />

      {/* Bottom nav (mobile) */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border flex">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => changeTab(t.key)}
              className={`toque flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] ${tab === t.key ? 'text-primary' : 'text-muted-foreground'}`}>
              <Icon className="w-5 h-5" />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
