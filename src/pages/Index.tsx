import { useState, useCallback, useRef, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useWatchStore } from '@/store/useWatchStore';
import { useAuth } from '@/contexts/AuthContext';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { WatchItem } from '@/types/watch';
import {
  MediaSummary, trendingWeek, recent, discoverByGenre, discoverAnime, getDetails,
  MOVIE_GENRES, TV_GENRES, ANIME_ROWS, type TmdbMediaType,
} from '@/lib/tmdb';
import { initPush, loadSubs, onPushOpen } from '@/lib/notifications';
import { getCastNow, type CastNow } from '@/lib/nativePlayer';
import MediaRow from '@/components/streaming/MediaRow';
import CategoryView from '@/components/streaming/CategoryView';
import MediaDetail from '@/components/streaming/MediaDetail';
import SearchView, { clearSearchCache } from '@/components/streaming/SearchView';
import BrowseView from '@/components/streaming/BrowseView';
import MediaCard from '@/components/streaming/MediaCard';
import ContinueView from '@/components/streaming/ContinueView';
import SettingsView, { type WatchedStats } from '@/components/streaming/SettingsView';
import NoticesView from '@/components/streaming/NoticesView';
import { useNotices } from '@/lib/appNotices';
import { startMp4Listener, useMp4All } from '@/lib/mp4Download';
import { useDownloadList } from '@/lib/downloads';
import HistoryView from '@/components/streaming/HistoryView';
import HeroCarousel from '@/components/streaming/HeroCarousel';
import DownloadView from '@/components/streaming/DownloadView';
import BugsView from '@/components/streaming/BugsView';
import LiveTvView from '@/components/streaming/LiveTvView';
import type { Channel } from '@/lib/liveTv';
import { continueLabel, continueProgress, totalEpisodesWatched } from '@/lib/watchProgress';
import UpdateChecker from '@/components/UpdateChecker';
import { Button } from '@/components/ui/button';
import { Home, Film, Tv, Sparkles, RadioTower, Compass, Search, Settings, Loader2, ArrowLeft, Bell } from 'lucide-react';

type Tab = 'inicio' | 'filmes' | 'series' | 'animes' | 'aovivo' | 'procurar';

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

const MOVIE_ROW_IDS = MOVIE_GENRES.map(g => g.id);
const TV_ROW_IDS = TV_GENRES.map(g => g.id);

// Loader de linha de gênero SEM repetição: cada título aparece só na sua categoria
// predominante (1º gênero dele que tem linha) — evita Superman em Ação+Aventura+Ficção.
// Mesma ideia para as linhas da aba Animes, que NÃO tinham dedup: como o discover
// exige o gênero 16 (animação), todo anime cai em "Animação" e ainda aparecia em
// Comédia e Drama ao mesmo tempo. Aqui a "predominante" é a PRIMEIRA linha (na ordem
// das linhas) cujo gênero o título tem — "Animação", por ficar no fim, vira o fallback
// de quem não se encaixa em nenhuma outra.
const ANIME_ROW_IDS = ANIME_ROWS.map(r => r.id).filter((id): id is number => id != null);
const animeRowLoader = (rowId: number | null) => async () => {
  const items = await discoverAnime(1, rowId);
  if (rowId == null) return items;            // "Populares" mostra tudo
  return items.filter(m => {
    const primary = ANIME_ROW_IDS.find(id => (m.genreIds || []).includes(id));
    return primary === undefined || primary === rowId;
  });
};

const genreRowLoader = (type: TmdbMediaType, genreId: number, rowIds: number[]) => async () => {
  const items = await discoverByGenre(type, genreId);
  return items.filter(m => {
    const primary = (m.genreIds || []).find(g => rowIds.includes(g));
    return primary === undefined || primary === genreId;
  });
};

const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'inicio', label: 'Início', icon: Home },
  { key: 'filmes', label: 'Filmes', icon: Film },
  { key: 'series', label: 'Séries', icon: Tv },
  { key: 'animes', label: 'Animes', icon: Sparkles },
  { key: 'aovivo', label: 'Ao Vivo', icon: RadioTower },
  { key: 'procurar', label: 'Procurar', icon: Compass },
];

export default function Index() {
  const { signOut, user } = useAuth();
  const store = useWatchStore(user?.id);
  const [tab, setTab] = useState<Tab>('inicio');
  const [selected, setSelected] = useState<MediaSummary | null>(null);
  const [category, setCategory] = useState<null | { title: string; loadPage: (p: number) => Promise<MediaSummary[]>; cacheKey?: string }>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [continueFilter, setContinueFilter] = useState<null | 'movie' | 'series' | 'anime'>(null);
  const [listFilter, setListFilter] = useState<null | 'movie' | 'series' | 'anime'>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const { unread: unreadNotices } = useNotices();
  useEffect(() => { startMp4Listener(); }, []);     // avisos de conversão desde o boot
  // Badge do sino = avisos não lidos + o que está EM ANDAMENTO. Abrir o sino zera
  // os lidos, mas enquanto um download/conversão roda o número continua lá — some
  // só quando termina E o aviso de conclusão é visto.
  const { items: dlItemsAll } = useDownloadList();
  const dlAtivos = [...dlItemsAll.values()].filter(d => d.state === 'downloading' || d.state === 'queued' || d.state === 'restarting').length;
  const mp4Ativos = useMp4All().filter(m => m.state !== 'done').length;
  const badgeNotices = unreadNotices + dlAtivos + mp4Ativos;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [bugsOpen, setBugsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);          // Minha Lista (agora dentro do Painel)
  const [liveChannel, setLiveChannel] = useState<Channel | null>(null); // canal ao vivo tocando

  // Push: registra o device e carrega os sinos; tocar na notificação abre o título.
  useEffect(() => {
    initPush();
    loadSubs();
    onPushOpen(({ tmdbId, type }) => {
      getDetails(tmdbId, type === 'tv' ? 'tv' : 'movie')
        .then(d => setSelected({ tmdbId, title: d.title, posterUrl: d.posterUrl, type, rating: d.rating, votes: d.votes }))
        .catch(() => {});
    });
  }, []);

  // Preserva o scroll vertical da página ao abrir um título e voltar.
  const homeScrollRef = useRef(0);
  const openMedia = useCallback((m: MediaSummary) => { homeScrollRef.current = window.scrollY; setSelected(m); }, []);

  // O que está espelhando na TV agora (o estado vive no nativo e sobrevive ao
  // fechar o player) → atalho no topo pra voltar pro episódio que está na TV.
  const [castNow, setCastNow] = useState<CastNow | null>(null);
  const [autoPlay, setAutoPlay] = useState<null | { season: number; episode: number }>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => { getCastNow().then(c => { if (alive) setCastNow(c); }).catch(() => {}); };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

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
        window.scrollTo(0, 0);
      })
      .catch(() => {});
  }, [castNow]);
  useEffect(() => {
    if (!selected) {
      const y = homeScrollRef.current;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [selected]);
  const openGenre = (type: TmdbMediaType, id: number, name: string) =>
    setCategory({ title: name, loadPage: (p) => discoverByGenre(type, id, p), cacheKey: `cat-${type}-${id}` });

  const handleBack = useCallback(async (): Promise<boolean> => {
    if (liveChannel) { setLiveChannel(null); return true; }
    if (selected) { setSelected(null); return true; }
    if (historyOpen) { setHistoryOpen(false); return true; }
    if (downloadOpen) { setDownloadOpen(false); return true; }
    if (bugsOpen) { setBugsOpen(false); return true; }
    if (listFilter) { setListFilter(null); return true; }
    if (listOpen) { setListOpen(false); return true; }
    if (noticesOpen) { setNoticesOpen(false); return true; }
    if (settingsOpen) { setSettingsOpen(false); return true; }
    if (searchOpen) { setSearchOpen(false); clearSearchCache(); return true; }
    if (continueFilter) { setContinueFilter(null); return true; }
    if (category) { setCategory(null); return true; }
    if (tab !== 'inicio') { setTab('inicio'); return true; }
    return false;
  }, [liveChannel, selected, historyOpen, downloadOpen, bugsOpen, settingsOpen, noticesOpen, searchOpen, continueFilter, listFilter, listOpen, category, tab]);
  useAndroidBackButton(handleBack);

  if (store.loading) {
    return <div className="flex h-screen items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const toCont = (i: WatchItem): MediaSummary => ({ ...itemToSummary(i), subtitle: continueLabel(i), progress: continueProgress(i) ?? undefined });
  const continueAll = store.continueWatching.filter(i => i.tmdbId);
  const continueMovies = continueAll.filter(i => i.type === 'movie').map(toCont);
  const continueAnimes = continueAll.filter(isAnime).map(toCont);
  const continueSeries = continueAll.filter(i => i.type === 'series' && !isAnime(i)).map(toCont);
  const continueFiltered = continueFilter === 'movie' ? continueAll.filter(i => i.type === 'movie')
    : continueFilter === 'anime' ? continueAll.filter(isAnime)
    : continueFilter === 'series' ? continueAll.filter(i => i.type === 'series' && !isAnime(i))
    : continueAll;
  const continueEntries = continueFiltered.map(i => ({ id: i.id, summary: toCont(i) }));
  const continueTitle = continueFilter === 'movie' ? 'Continuar assistindo seus filmes'
    : continueFilter === 'anime' ? 'Continuar assistindo seus animes'
    : continueFilter === 'series' ? 'Continuar assistindo suas séries'
    : 'Continuar assistindo';
  const savedList = store.myList.filter(i => i.tmdbId);
  const listMovies = savedList.filter(i => i.type === 'movie').map(itemToSummary);
  const listAnimes = savedList.filter(isAnime).map(itemToSummary);
  const listSeries = savedList.filter(i => i.type === 'series' && !isAnime(i)).map(itemToSummary);
  const listFiltered = listFilter === 'movie' ? listMovies : listFilter === 'anime' ? listAnimes : listFilter === 'series' ? listSeries : [];
  const listTitle = listFilter === 'movie' ? 'Filmes' : listFilter === 'anime' ? 'Animes' : 'Séries';

  // ── Assistidos (painel + histórico) ──
  // Filme: marcado como concluído. Série/anime: ≥1 episódio marcado.
  const watchedItems = store.data.items.filter(i => i.tmdbId &&
    (i.type === 'movie' ? !!i.completed : totalEpisodesWatched(i) > 0));
  const watchedMovies = watchedItems.filter(i => i.type === 'movie');
  const watchedAnimes = watchedItems.filter(isAnime);
  const watchedSeries = watchedItems.filter(i => i.type === 'series' && !isAnime(i));
  const sumEps = (arr: WatchItem[]) => arr.reduce((n, i) => n + totalEpisodesWatched(i), 0);
  const watchedStats: WatchedStats = {
    moviesCount: watchedMovies.length,
    seriesCount: watchedSeries.length,
    seriesEpisodes: sumEps(watchedSeries),
    animesCount: watchedAnimes.length,
    animeEpisodes: sumEps(watchedAnimes),
  };
  const histMovies = watchedMovies.map(itemToSummary);
  const histSeries = watchedSeries.map(itemToSummary);
  const histAnimes = watchedAnimes.map(itemToSummary);

  const changeTab = (t: Tab) => { setTab(t); setSelected(null); setCategory(null); setSearchOpen(false); clearSearchCache(); setContinueFilter(null); setListFilter(null); setSettingsOpen(false); setHistoryOpen(false); setDownloadOpen(false); setBugsOpen(false); setNoticesOpen(false); setListOpen(false); setLiveChannel(null); };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/logo.png" alt="WatchMov" className="h-7 cursor-pointer" onClick={() => changeTab('inicio')} />
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
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === t.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className={`h-8 w-8 ${searchOpen ? 'text-primary' : 'text-muted-foreground'}`} onClick={() => setSearchOpen(o => { if (o) clearSearchCache(); return !o; })} title="Buscar">
              <Search className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className={`relative h-8 w-8 ${noticesOpen ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={() => { setNoticesOpen(o => !o); setSettingsOpen(false); setSelected(null); setCategory(null); setSearchOpen(false); }} title="Notificações">
              <Bell className="w-4 h-4" />
              {badgeNotices > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center">
                  {badgeNotices > 9 ? '9+' : badgeNotices}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="icon" className={`h-8 w-8 ${settingsOpen ? 'text-primary' : 'text-muted-foreground'}`} onClick={() => { setSettingsOpen(o => !o); setNoticesOpen(false); setHistoryOpen(false); setSelected(null); setCategory(null); setSearchOpen(false); }} title="Painel">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Player de canal ao vivo — overlay full-screen (iframe modo servidor). */}
      {liveChannel && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center gap-2 px-3 h-12 bg-black/90 text-white shrink-0">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white hover:bg-white/10" onClick={() => setLiveChannel(null)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <span className="text-sm font-medium truncate">{liveChannel.name}</span>
          </div>
          <iframe key={liveChannel.embed} src={liveChannel.embed} title={liveChannel.name}
            className="flex-1 w-full border-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen referrerPolicy="origin"
            sandbox={Capacitor.isNativePlatform() ? undefined : 'allow-scripts allow-same-origin allow-forms allow-presentation'} />
        </div>
      )}

      {/* Conteúdo */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-6 py-4 pb-24 sm:pb-6">
        {selected ? (
          <MediaDetail media={selected} store={store} autoPlay={autoPlay} castNow={castNow}
            onBack={() => { setAutoPlay(null); setSelected(null); }}
            /* Relacionado NÃO passa pelo openMedia: ele grava o scroll da HOME, e aqui
               estamos dentro do detalhe — sobrescrever bagunçaria a volta. */
            onOpen={(m) => { setSelected(m); window.scrollTo(0, 0); }} />
        ) : noticesOpen ? (
          <NoticesView onBack={() => setNoticesOpen(false)} />
        ) : settingsOpen ? (
          historyOpen ? (
            <HistoryView movies={histMovies} series={histSeries} animes={histAnimes} onOpen={openMedia} onBack={() => setHistoryOpen(false)} />
          ) : downloadOpen ? (
            <DownloadView onBack={() => setDownloadOpen(false)} />
          ) : bugsOpen ? (
            <BugsView onBack={() => setBugsOpen(false)} />
          ) : listOpen ? (
            <div className="space-y-6 animate-fade-in">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { if (listFilter) setListFilter(null); else setListOpen(false); }}><ArrowLeft className="w-5 h-5" /></Button>
                <h1 className="text-xl font-bold">{listFilter ? listTitle : 'Minha Lista'}</h1>
              </div>
              {listFilter ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {listFiltered.map(m => <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} onClick={() => openMedia(m)} />)}
                </div>
              ) : (listMovies.length === 0 && listSeries.length === 0 && listAnimes.length === 0) ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Sua lista está vazia. Toque em "+ Lista" num título.</p>
              ) : (
                <>
                  {listMovies.length > 0 && <MediaRow title="Filmes" items={listMovies} onOpen={openMedia} onSeeAll={() => setListFilter('movie')} />}
                  {listSeries.length > 0 && <MediaRow title="Séries" items={listSeries} onOpen={openMedia} onSeeAll={() => setListFilter('series')} />}
                  {listAnimes.length > 0 && <MediaRow title="Animes" items={listAnimes} onOpen={openMedia} onSeeAll={() => setListFilter('anime')} />}
                </>
              )}
            </div>
          ) : (
            <SettingsView stats={watchedStats} onList={() => setListOpen(true)} onHistory={() => setHistoryOpen(true)} onDownload={() => setDownloadOpen(true)} onBugs={() => setBugsOpen(true)} onSignOut={signOut} onBack={() => setSettingsOpen(false)} />
          )
        ) : searchOpen ? (
          <SearchView onOpen={openMedia} />
        ) : continueFilter ? (
          <ContinueView title={continueTitle} entries={continueEntries} onOpen={openMedia} onRemove={store.clearProgress} onBack={() => setContinueFilter(null)} />
        ) : category ? (
          <CategoryView title={category.title} loadPage={category.loadPage} cacheKey={category.cacheKey} onOpen={openMedia} onBack={() => setCategory(null)} />
        ) : tab === 'inicio' ? (
          <div className="space-y-6">
            <HeroCarousel onOpen={openMedia} />
            {continueMovies.length > 0 && (
              <MediaRow title="Continuar assistindo seus filmes" items={continueMovies} onOpen={openMedia} onSeeAll={() => setContinueFilter('movie')} />
            )}
            {continueSeries.length > 0 && (
              <MediaRow title="Continuar assistindo suas séries" items={continueSeries} onOpen={openMedia} onSeeAll={() => setContinueFilter('series')} />
            )}
            {continueAnimes.length > 0 && (
              <MediaRow title="Continuar assistindo seus animes" items={continueAnimes} onOpen={openMedia} onSeeAll={() => setContinueFilter('anime')} />
            )}
            <MediaRow title="🔥 Top 10 da semana" numbered cacheKey="top10-movie"
              loader={() => trendingWeek('movie')} onOpen={openMedia} />
            <MediaRow title="Top 10 séries" numbered cacheKey="top10-tv"
              loader={() => trendingWeek('tv')} onOpen={openMedia} />
            <MediaRow title="Lançamentos recentes" cacheKey="recent-movie"
              loader={() => recent('movie')} onOpen={openMedia}
              onSeeAll={() => setCategory({ title: 'Lançamentos recentes', loadPage: () => recent('movie'), cacheKey: 'cat-recent-movie' })} />
            {MOVIE_GENRES.slice(0, 6).map(g => (
              <MediaRow key={g.id} title={g.name} cacheKey={`m-${g.id}`}
                loader={genreRowLoader('movie', g.id, MOVIE_ROW_IDS)} onOpen={openMedia}
                onSeeAll={() => openGenre('movie', g.id, g.name)} />
            ))}
            <footer className="pt-4 border-t border-border/50">
              <UpdateChecker />
            </footer>
          </div>
        ) : tab === 'filmes' ? (
          <div className="space-y-6">
            {MOVIE_GENRES.map(g => (
              <MediaRow key={g.id} title={g.name} cacheKey={`m-${g.id}`}
                loader={genreRowLoader('movie', g.id, MOVIE_ROW_IDS)} onOpen={openMedia}
                onSeeAll={() => openGenre('movie', g.id, g.name)} />
            ))}
          </div>
        ) : tab === 'series' ? (
          <div className="space-y-6">
            {TV_GENRES.map(g => (
              <MediaRow key={g.id} title={g.name} cacheKey={`t-${g.id}`}
                loader={genreRowLoader('tv', g.id, TV_ROW_IDS)} onOpen={openMedia}
                onSeeAll={() => openGenre('tv', g.id, g.name)} />
            ))}
          </div>
        ) : tab === 'animes' ? (
          <div className="space-y-6">
            {ANIME_ROWS.map(r => (
              <MediaRow key={r.name} title={r.name} cacheKey={`a-${r.id ?? 'pop'}`}
                loader={animeRowLoader(r.id)} onOpen={openMedia}
                onSeeAll={() => setCategory({ title: r.name, loadPage: (p) => discoverAnime(p, r.id), cacheKey: `cat-anime-${r.id ?? 'pop'}` })} />
            ))}
          </div>
        ) : tab === 'procurar' ? (
          <BrowseView onOpen={openMedia} />
        ) : (
          <LiveTvView onPlay={setLiveChannel} />
        )}
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border flex">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => changeTab(t.key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] ${tab === t.key ? 'text-primary' : 'text-muted-foreground'}`}>
              <Icon className="w-5 h-5" />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
