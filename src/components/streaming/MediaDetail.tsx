import { useEffect, useState, useCallback } from 'react';
import { MediaSummary, getDetails, type TmdbDetails } from '@/lib/tmdb';
import { WatchItem, Season } from '@/types/watch';
import { generateId } from '@/store/useWatchStore';
import { formatRating } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import VideoPlayer from '@/components/VideoPlayer';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { ArrowLeft, Play, Plus, Check, Star, Loader2 } from 'lucide-react';

interface StoreLike {
  data: { items: WatchItem[] };
  upsertLibraryItem: (m: {
    tmdbId: number; type: 'movie' | 'series'; title: string; imdbId?: string;
    posterUrl?: string; synopsis?: string; genre?: string; rating?: number;
    votes?: number; totalDuration?: number; seasons?: Season[];
  }) => Promise<WatchItem | null>;
  updateItem: (id: string, updates: Partial<WatchItem>) => void;
  incrementEpisode: (itemId: string, seasonId: string) => void;
}

interface MediaDetailProps {
  media: MediaSummary;
  store: StoreLike;
  onBack: () => void;
}

export default function MediaDetail({ media, store, onBack }: MediaDetailProps) {
  const storeType: 'movie' | 'series' = media.type === 'tv' ? 'series' : 'movie';
  const isSeries = storeType === 'series';

  const [details, setDetails] = useState<TmdbDetails | null>(null);
  const [libItem, setLibItem] = useState<WatchItem | null>(
    store.data.items.find(i => i.tmdbId === media.tmdbId && i.type === storeType) ?? null
  );
  const [player, setPlayer] = useState<null | { season?: number; episode?: number }>(null);
  const [selSeason, setSelSeason] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getDetails(media.tmdbId, media.type)
      .then(d => { if (alive) setDetails(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [media.tmdbId, media.type]);

  const handlePlayerBack = useCallback(async (): Promise<boolean> => {
    if (player) { setPlayer(null); return true; }
    return false;
  }, [player]);
  useAndroidBackButton(handlePlayerBack);

  const seasonsFromDetails = useCallback((): Season[] => {
    return (details?.seasons || []).map(s => ({
      id: generateId(),
      number: s.number,
      totalEpisodes: s.totalEpisodes,
      watchedEpisodes: 0,
      episodeDuration: s.episodeDuration,
    }));
  }, [details]);

  const ensureLib = useCallback(async (): Promise<WatchItem | null> => {
    if (libItem) return libItem;
    const created = await store.upsertLibraryItem({
      tmdbId: media.tmdbId,
      type: storeType,
      title: details?.title || media.title,
      imdbId: details?.imdbId,
      posterUrl: details?.posterUrl || media.posterUrl,
      synopsis: details?.synopsis,
      genre: details?.genre,
      rating: details?.rating ?? media.rating,
      votes: details?.votes ?? media.votes,
      totalDuration: details?.runtime,
      seasons: isSeries ? seasonsFromDetails() : undefined,
    });
    if (created) setLibItem(created);
    return created;
  }, [libItem, store, media, details, storeType, isSeries, seasonsFromDetails]);

  const mediaId = libItem?.imdbId || details?.imdbId || String(media.tmdbId);

  const playMovie = async () => { await ensureLib(); setPlayer({}); };
  const playEpisode = async (seasonNum: number, ep: number) => { await ensureLib(); setPlayer({ season: seasonNum, episode: ep }); };

  const toggleList = async () => {
    const it = await ensureLib();
    if (!it) return;
    store.updateItem(it.id, { favorite: !it.favorite });
    setLibItem({ ...it, favorite: !it.favorite });
  };

  const onMovieProgress = (secs: number) => {
    if (!libItem) return;
    const mins = Math.min(Math.round(secs / 60), libItem.totalDuration || Infinity);
    store.updateItem(libItem.id, { watchedDuration: mins, lastWatchedAt: new Date().toISOString() });
  };
  const onMovieCompleted = () => {
    if (libItem) store.updateItem(libItem.id, { completed: true, watchedDuration: libItem.totalDuration, lastWatchedAt: new Date().toISOString() });
    setPlayer(null);
  };
  const onSeriesCompleted = () => {
    if (!player?.season || !libItem?.seasons) { setPlayer(null); return; }
    const season = libItem.seasons.find(s => s.number === player.season);
    if (season) store.incrementEpisode(libItem.id, season.id);
    const nextEp = (player.episode || 1) + 1;
    if (season && nextEp <= season.totalEpisodes) setPlayer({ season: player.season, episode: nextEp });
    else setPlayer(null);
  };

  const rating = formatRating(details?.rating ?? media.rating, details?.votes ?? media.votes);
  const inList = !!libItem?.favorite;
  const resumeMins = !isSeries ? (libItem?.watchedDuration || 0) : 0;

  return (
    <div className="animate-fade-in pb-8">
      {/* Backdrop */}
      <div className="relative -mx-4 md:-mx-6 -mt-4 md:-mt-6">
        <div className="aspect-video w-full bg-muted overflow-hidden">
          {(media.backdropUrl || media.posterUrl) && (
            <img src={media.backdropUrl || media.posterUrl} alt="" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        </div>
        <Button variant="ghost" size="icon" onClick={onBack} className="absolute top-3 left-3 h-9 w-9 bg-background/60 backdrop-blur">
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>

      <div className="-mt-12 relative px-1 space-y-3">
        <h1 className="text-2xl font-bold text-foreground">{details?.title || media.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {media.year && <span>{media.year}</span>}
          {rating && <span className="flex items-center gap-1 text-foreground font-medium"><Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {rating}</span>}
          <span className="px-2 py-0.5 rounded bg-muted text-xs">{isSeries ? 'Série' : 'Filme'}</span>
        </div>
        {details?.genre && (
          <div className="flex flex-wrap gap-1">
            {details.genre.split(',').map((g, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">{g.trim()}</span>
            ))}
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-2 pt-1">
          {!isSeries && (
            <Button className="flex-1" onClick={playMovie}>
              <Play className="w-4 h-4 mr-1" /> {resumeMins > 0 ? 'Continuar' : 'Assistir'}
            </Button>
          )}
          <Button variant={inList ? 'default' : 'outline'} className={isSeries ? 'flex-1' : ''} onClick={toggleList}>
            {inList ? <Check className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />} Minha Lista
          </Button>
        </div>

        {details?.synopsis && <p className="text-sm text-muted-foreground leading-relaxed">{details.synopsis}</p>}

        {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Carregando detalhes…</div>}

        {/* Séries: temporadas/episódios */}
        {isSeries && details?.seasons && details.seasons.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap gap-2">
              {details.seasons.map(s => (
                <button
                  key={s.number}
                  onClick={() => setSelSeason(s.number)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${selSeason === s.number ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  T{s.number}
                </button>
              ))}
            </div>
            {(() => {
              const s = details.seasons.find(x => x.number === selSeason) || details.seasons[0];
              const watched = libItem?.seasons?.find(x => x.number === s.number)?.watchedEpisodes || 0;
              return (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {Array.from({ length: s.totalEpisodes }, (_, i) => i + 1).map(ep => (
                    <button
                      key={ep}
                      onClick={() => playEpisode(s.number, ep)}
                      className={`aspect-square rounded-lg flex items-center justify-center text-sm font-medium border transition ${ep <= watched ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted/50 hover:border-primary text-foreground'}`}
                    >
                      {ep}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {player && (
        <VideoPlayer
          open={!!player}
          onClose={() => setPlayer(null)}
          mediaId={mediaId}
          type={media.type}
          season={player.season}
          episode={player.episode}
          title={isSeries && player.season ? `${media.title} — T${player.season} E${player.episode}` : (details?.title || media.title)}
          resumeAt={resumeMins > 0 ? resumeMins * 60 : undefined}
          onProgress={!isSeries ? onMovieProgress : undefined}
          onCompleted={isSeries ? onSeriesCompleted : onMovieCompleted}
        />
      )}
    </div>
  );
}
