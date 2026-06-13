import { useState, useCallback } from 'react';
import { useWatchStore } from '@/store/useWatchStore';
import { useAuth } from '@/contexts/AuthContext';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { WatchItem } from '@/types/watch';
import {
  MediaSummary, trendingWeek, recent, discoverByGenre,
  MOVIE_GENRES, TV_GENRES, type TmdbMediaType,
} from '@/lib/tmdb';
import MediaRow from '@/components/streaming/MediaRow';
import CategoryView from '@/components/streaming/CategoryView';
import MediaDetail from '@/components/streaming/MediaDetail';
import SearchView from '@/components/streaming/SearchView';
import MediaCard from '@/components/streaming/MediaCard';
import UpdateChecker from '@/components/UpdateChecker';
import { Button } from '@/components/ui/button';
import { Home, Film, Tv, Bookmark, Search, LogOut, Loader2 } from 'lucide-react';

type Tab = 'inicio' | 'filmes' | 'series' | 'lista' | 'buscar';

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

const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'inicio', label: 'Início', icon: Home },
  { key: 'filmes', label: 'Filmes', icon: Film },
  { key: 'series', label: 'Séries', icon: Tv },
  { key: 'lista', label: 'Minha Lista', icon: Bookmark },
  { key: 'buscar', label: 'Buscar', icon: Search },
];

export default function Index() {
  const { signOut, user } = useAuth();
  const store = useWatchStore(user?.id);
  const [tab, setTab] = useState<Tab>('inicio');
  const [selected, setSelected] = useState<MediaSummary | null>(null);
  const [category, setCategory] = useState<null | { title: string; loadPage: (p: number) => Promise<MediaSummary[]> }>(null);

  const openMedia = useCallback((m: MediaSummary) => setSelected(m), []);
  const openGenre = (type: TmdbMediaType, id: number, name: string) =>
    setCategory({ title: name, loadPage: (p) => discoverByGenre(type, id, p) });

  const handleBack = useCallback(async (): Promise<boolean> => {
    if (selected) { setSelected(null); return true; }
    if (category) { setCategory(null); return true; }
    if (tab !== 'inicio') { setTab('inicio'); return true; }
    return false;
  }, [selected, category, tab]);
  useAndroidBackButton(handleBack);

  if (store.loading) {
    return <div className="flex h-screen items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const continueItems = store.continueWatching.filter(i => i.tmdbId).map(itemToSummary);
  const listItems = store.myList.filter(i => i.tmdbId).map(itemToSummary);

  const changeTab = (t: Tab) => { setTab(t); setSelected(null); setCategory(null); };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/logo.png" alt="WatchMov" className="h-7 cursor-pointer" onClick={() => changeTab('inicio')} />
          <nav className="hidden sm:flex items-center gap-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => changeTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === t.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={signOut} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-6 py-4 pb-24 sm:pb-6">
        {selected ? (
          <MediaDetail media={selected} store={store} onBack={() => setSelected(null)} />
        ) : category ? (
          <CategoryView title={category.title} loadPage={category.loadPage} onOpen={openMedia} onBack={() => setCategory(null)} />
        ) : tab === 'inicio' ? (
          <div className="space-y-6">
            {continueItems.length > 0 && (
              <MediaRow title="Continuar assistindo" items={continueItems} onOpen={openMedia} />
            )}
            <MediaRow title="🔥 Top 10 da semana" numbered cacheKey="top10-movie"
              loader={() => trendingWeek('movie')} onOpen={openMedia} />
            <MediaRow title="Top 10 séries" numbered cacheKey="top10-tv"
              loader={() => trendingWeek('tv')} onOpen={openMedia} />
            <MediaRow title="Lançamentos recentes" cacheKey="recent-movie"
              loader={() => recent('movie')} onOpen={openMedia}
              onSeeAll={() => setCategory({ title: 'Lançamentos recentes', loadPage: () => recent('movie') })} />
            {MOVIE_GENRES.slice(0, 6).map(g => (
              <MediaRow key={g.id} title={g.name} cacheKey={`m-${g.id}`}
                loader={() => discoverByGenre('movie', g.id)} onOpen={openMedia}
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
                loader={() => discoverByGenre('movie', g.id)} onOpen={openMedia}
                onSeeAll={() => openGenre('movie', g.id, g.name)} />
            ))}
          </div>
        ) : tab === 'series' ? (
          <div className="space-y-6">
            {TV_GENRES.map(g => (
              <MediaRow key={g.id} title={g.name} cacheKey={`t-${g.id}`}
                loader={() => discoverByGenre('tv', g.id)} onOpen={openMedia}
                onSeeAll={() => openGenre('tv', g.id, g.name)} />
            ))}
          </div>
        ) : tab === 'lista' ? (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">Minha Lista</h1>
            {listItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sua lista está vazia. Toque em "+ Minha Lista" num título.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {listItems.map(m => <MediaCard key={`${m.type}-${m.tmdbId}`} media={m} onClick={() => openMedia(m)} />)}
              </div>
            )}
          </div>
        ) : (
          <SearchView onOpen={openMedia} />
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
