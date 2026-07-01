import { useEffect, useState, useCallback, useRef } from 'react';
import { MediaSummary, getDetails, type TmdbDetails } from '@/lib/tmdb';
import { WatchItem, Season } from '@/types/watch';
import { generateId } from '@/store/useWatchStore';
import { formatRating } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import VideoPlayer from '@/components/VideoPlayer';
import StremioStreamsDialog from '@/components/streaming/StremioStreamsDialog';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { ArrowLeft, Play, Plus, Check, CheckCheck, Eye, Star, Loader2, Download, DownloadCloud, X as XIcon } from 'lucide-react';
import { episodesWatched, isEpisodeWatched, lastStopped } from '@/lib/watchProgress';
import { useDownloads, setDownloaded, movieKey, epKey } from '@/lib/downloads';

interface StoreLike {
  data: { items: WatchItem[] };
  upsertLibraryItem: (m: {
    tmdbId: number; type: 'movie' | 'series'; title: string; imdbId?: string;
    posterUrl?: string; synopsis?: string; genre?: string; rating?: number;
    votes?: number; totalDuration?: number; seasons?: Season[];
  }) => Promise<WatchItem | null>;
  updateItem: (id: string, updates: Partial<WatchItem>) => void;
  incrementEpisode: (itemId: string, seasonId: string) => void;
  setEpisodeWatched: (itemId: string, seasonNumber: number, episode: number, watched: boolean) => void;
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
  // Versão "viva" do store (reflete marcações de episódio/progresso em tempo real).
  const liveItem = store.data.items.find(i => i.tmdbId === media.tmdbId && i.type === storeType) ?? libItem;
  const [player, setPlayer] = useState<null | { season?: number; episode?: number; directUrl?: string; directLabel?: string; torrent?: { magnet: string; fileIdx?: number } }>(null);
  const [stremioOpen, setStremioOpen] = useState(false);
  const [selSeason, setSelSeason] = useState(1);
  const [loading, setLoading] = useState(true);
  const dls = useDownloads();
  const [selecting, setSelecting] = useState(false);   // modo seleção de eps p/ baixar
  const [selEps, setSelEps] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    getDetails(media.tmdbId, media.type)
      .then(d => { if (alive) setDetails(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [media.tmdbId, media.type]);

  // Abre já na última temporada assistida (1x; não sobrescreve escolha manual).
  const seasonInitRef = useRef(false);
  useEffect(() => {
    if (seasonInitRef.current || !details?.seasons?.length) return;
    const ls = liveItem ? lastStopped(liveItem) : null;
    if (ls && details.seasons.some(s => s.number === ls.season)) setSelSeason(ls.season);
    seasonInitRef.current = true;
  }, [details, liveItem]);

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

  // Marca o item como "assistido agora" pra entrar em Continuar assistindo
  // (players BR não disparam evento de progresso).
  const markWatched = (it: WatchItem | null) => {
    if (it) store.updateItem(it.id, { lastWatchedAt: new Date().toISOString() });
  };
  const playMovie = async () => { const it = await ensureLib(); markWatched(it); setPlayer({}); };
  const playEpisode = async (seasonNum: number, ep: number) => {
    const it = await ensureLib();
    markWatched(it); // entra em "Continuar assistindo"; NÃO marca assistido (só faltando 1 min ou manual)
    setPlayer({ season: seasonNum, episode: ep });
  };
  const playStremio = async (url: string, label: string, season?: number, episode?: number) => {
    await ensureLib();
    setStremioOpen(false);
    setPlayer({ season, episode, directUrl: url, directLabel: label });
  };
  const playStremioTorrent = async (magnet: string, fileIdx: number | undefined, label: string, season?: number, episode?: number) => {
    await ensureLib();
    setStremioOpen(false);
    setPlayer({ season, episode, directLabel: label, torrent: { magnet, fileIdx } });
  };

  // Próximo episódio não assistido (continuar de onde parou, séries).
  const nextSeriesEp = (): { season: number; episode: number } => {
    const seasons = liveItem?.seasons ? [...liveItem.seasons].sort((a, b) => a.number - b.number) : [];
    for (const s of seasons) {
      const watched = episodesWatched(s);
      for (let ep = 1; ep <= s.totalEpisodes; ep++) if (!watched.includes(ep)) return { season: s.number, episode: ep };
    }
    return { season: 1, episode: 1 };
  };
  // Botão principal = servidores embed (filme retoma via resumeAt; série continua no próximo ep).
  const playMain = async () => {
    if (isSeries) { const c = nextSeriesEp(); await playEpisode(c.season, c.episode); }
    else { await playMovie(); }
  };

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
    if (!player?.season || !liveItem) { setPlayer(null); return; }
    store.setEpisodeWatched(liveItem.id, player.season, player.episode || 1, true); // marca o atual
    const season = liveItem.seasons?.find(s => s.number === player.season);
    const nextEp = (player.episode || 1) + 1;
    if (season && nextEp <= season.totalEpisodes) playEpisode(player.season, nextEp); // abre+marca o próximo
    else setPlayer(null);
  };

  const movieWatched = !isSeries && !!liveItem?.completed;

  // ── Download (WIP: marca estado; salvamento real do vídeo é etapa nativa) ──
  const movieDownloaded = !isSeries && dls.has(movieKey(media.tmdbId));
  const toggleMovieDownload = async () => {
    await ensureLib();
    setDownloaded([movieKey(media.tmdbId)], !movieDownloaded);
  };
  const startSelecting = () => { setSelEps(new Set()); setSelecting(true); };
  const cancelSelecting = () => { setSelecting(false); setSelEps(new Set()); };
  const toggleSelEp = (ep: number) => setSelEps(prev => {
    const next = new Set(prev);
    if (next.has(ep)) next.delete(ep); else next.add(ep);
    return next;
  });
  const confirmDownload = async () => {
    if (selEps.size === 0) { cancelSelecting(); return; }
    await ensureLib();
    setDownloaded([...selEps].map(ep => epKey(media.tmdbId, selSeason, ep)), true);
    cancelSelecting();
  };

  const rating = formatRating(details?.rating ?? media.rating, details?.votes ?? media.votes);
  const inList = !!liveItem?.favorite;
  const resumeMins = !isSeries ? (liveItem?.watchedDuration || 0) : 0;
  const hasProgress = resumeMins > 0 || (isSeries && !!liveItem?.seasons?.some(s => episodesWatched(s).length > 0));
  const lastWatchedLabel = liveItem?.lastWatchedAt
    ? new Date(liveItem.lastWatchedAt).toLocaleDateString('pt-BR')
    : null;
  // Há próximo episódio na temporada atual do player?
  const curPlayerSeason = liveItem?.seasons?.find(s => s.number === player?.season);
  const hasNextEp = !!(player?.season && curPlayerSeason && (player.episode || 1) < curPlayerSeason.totalEpisodes);

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
          {details?.originalLanguage && (
            <span className="px-2 py-0.5 rounded bg-muted text-xs">Áudio original: {details.originalLanguage}</span>
          )}
        </div>
        {lastWatchedLabel && (
          <p className="text-xs text-green-400">Visto por último em {lastWatchedLabel}</p>
        )}
        {details?.genre && (
          <div className="flex flex-wrap gap-1">
            {details.genre.split(',').map((g, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">{g.trim()}</span>
            ))}
          </div>
        )}

        {/* Ações — principal = servidores embed (retoma de onde parou); Torrent = Stremio/debrid */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button className="flex-1" onClick={playMain}>
            <Play className="w-4 h-4 mr-1" /> {hasProgress ? 'Continuar' : 'Assistir'}
          </Button>
          <Button variant="outline" onClick={() => setStremioOpen(true)} title="Torrent / Stremio (dublado via debrid)">
            <Download className="w-4 h-4 mr-1" /> Torrent
          </Button>
          <Button variant={inList ? 'default' : 'outline'} onClick={toggleList}>
            {inList ? <Check className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />} Lista
          </Button>
          {!isSeries && (
            <Button variant={movieWatched ? 'default' : 'outline'}
              title={movieWatched ? 'Marcado como assistido' : 'Marcar como assistido'}
              onClick={async () => { const it = await ensureLib(); if (it) store.updateItem(it.id, it.completed ? { completed: false } : { completed: true, watchedDuration: it.totalDuration || it.watchedDuration || 0, lastWatchedAt: new Date().toISOString() }); }}>
              {movieWatched ? <CheckCheck className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />} Assistido
            </Button>
          )}
          {isSeries ? (
            <Button variant={selecting ? 'default' : 'outline'} onClick={selecting ? cancelSelecting : startSelecting} title="Baixar episódios">
              <Download className="w-4 h-4 mr-1" /> {selecting ? 'Cancelar' : 'Baixar eps'}
            </Button>
          ) : (
            <Button variant={movieDownloaded ? 'default' : 'outline'} onClick={toggleMovieDownload} title={movieDownloaded ? 'Baixado' : 'Baixar filme'}>
              {movieDownloaded ? <DownloadCloud className="w-4 h-4 mr-1" /> : <Download className="w-4 h-4 mr-1" />} {movieDownloaded ? 'Baixado' : 'Baixar'}
            </Button>
          )}
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
              const liveSeason = liveItem?.seasons?.find(x => x.number === s.number);
              const watched = liveSeason ? episodesWatched(liveSeason) : [];
              return (
                <>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {Array.from({ length: s.totalEpisodes }, (_, i) => i + 1).map(ep => {
                      const seen = watched.includes(ep);
                      const downloaded = dls.has(epKey(media.tmdbId, s.number, ep));
                      const picked = selEps.has(ep);
                      return (
                        <button
                          key={ep}
                          onClick={() => (selecting ? (downloaded ? undefined : toggleSelEp(ep)) : playEpisode(s.number, ep))}
                          className={`relative aspect-square rounded-lg flex items-center justify-center text-sm font-medium border transition ${selecting && downloaded ? 'border-green-400/40 bg-green-400/5 text-muted-foreground opacity-70' : selecting && picked ? 'border-primary bg-primary/20 text-primary' : seen ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted/50 hover:border-primary text-foreground'}`}
                        >
                          {ep}
                          {seen && !selecting && <Check className="absolute top-0.5 right-0.5 w-3 h-3 text-primary" />}
                          {selecting && !downloaded && (
                            <span className={`absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${picked ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                              {picked && <Check className="w-3 h-3 text-primary-foreground" />}
                            </span>
                          )}
                          {downloaded && <DownloadCloud className="absolute bottom-0.5 right-0.5 w-4 h-4 text-green-400" />}
                        </button>
                      );
                    })}
                  </div>
                  {selecting && (
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" className="flex-1" onClick={confirmDownload} disabled={selEps.size === 0}>
                        <Download className="w-4 h-4 mr-1" /> Baixar{selEps.size > 0 ? ` (${selEps.size})` : ''}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelSelecting}><XIcon className="w-4 h-4" /></Button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {player && (
        <VideoPlayer
          open={!!player}
          onClose={() => setPlayer(null)}
          tmdbId={media.tmdbId}
          imdbId={libItem?.imdbId || details?.imdbId}
          type={media.type}
          season={player.season}
          episode={player.episode}
          title={isSeries && player.season ? `${media.title} — T${player.season} E${player.episode}` : (details?.title || media.title)}
          resumeAt={resumeMins > 0 ? resumeMins * 60 : undefined}
          directUrl={player.directUrl}
          torrent={player.torrent}
          watched={isSeries ? (player.season ? isEpisodeWatched(liveItem, player.season, player.episode) : undefined) : movieWatched}
          onSetWatched={
            isSeries
              ? (player.season && liveItem ? (v: boolean) => store.setEpisodeWatched(liveItem.id, player.season!, player.episode || 1, v) : undefined)
              : async (v: boolean) => {
                  const it = await ensureLib();
                  if (it) store.updateItem(it.id, v ? { completed: true, watchedDuration: it.totalDuration || it.watchedDuration || 0, lastWatchedAt: new Date().toISOString() } : { completed: false });
                }
          }
          onNext={isSeries && hasNextEp ? onSeriesCompleted : undefined}
          onProgress={!isSeries ? onMovieProgress : undefined}
          onCompleted={isSeries ? onSeriesCompleted : onMovieCompleted}
        />
      )}

      <StremioStreamsDialog
        open={stremioOpen}
        onOpenChange={setStremioOpen}
        imdbId={libItem?.imdbId || details?.imdbId}
        type={media.type}
        seasons={isSeries ? details?.seasons?.map(s => ({ number: s.number, totalEpisodes: s.totalEpisodes })) : undefined}
        title={details?.title || media.title}
        onPlayUrl={playStremio}
        onPlayTorrent={playStremioTorrent}
      />
    </div>
  );
}
