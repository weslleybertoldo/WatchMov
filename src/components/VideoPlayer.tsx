import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Tv, Copy, Smartphone, Layers, Check, Loader2, Subtitles, Maximize, Minimize, CheckSquare, Square, SkipForward, ChevronUp, Server, Sparkles } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import Hls from 'hls.js';
import { toast } from 'sonner';
import { PROVIDERS, type PlayerTarget } from '@/lib/players';
import { getTorrentStream, destroyTorrent } from '@/lib/torrentClient';
import { fetchSubtitles, srtUrlToVttBlob, type StremioSubtitle } from '@/lib/stremio';
import { watchStream, isNative, type SniffResult } from '@/lib/streamSniffer';
import { getCachedStream, setCachedStream, setStreamPosition, invalidateStream } from '@/lib/streamCache';
import { playNative } from '@/lib/nativePlayer';

interface ScreenCastPlugin { openCast(): Promise<void>; }
const ScreenCast = registerPlugin<ScreenCastPlugin>('ScreenCast');

interface ImmersivePlugin { enter(): Promise<void>; exit(): Promise<void>; toggleOrientation(): Promise<void>; }
const Immersive = registerPlugin<ImmersivePlugin>('Immersive');

interface VideoPlayerProps {
  open: boolean;
  onClose: () => void;
  tmdbId?: number;
  imdbId?: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  resumeAt?: number;          // segundos (só VidAPI usa)
  directUrl?: string;         // stream HTTP direto (Stremio) — toca em <video>, ignora provedores
  torrent?: { magnet: string; fileIdx?: number };  // WebTorrent (Stremio sem debrid)
  onProgress?: (seconds: number) => void;
  onCompleted?: () => void;
  episodeWatched?: boolean;        // série: episódio atual marcado como assistido
  onToggleWatched?: () => void;    // alterna a marcação do episódio atual
  onNext?: () => void;             // série: avança pro próximo episódio
}

export default function VideoPlayer(props: VideoPlayerProps) {
  const { open, onClose, tmdbId, imdbId, type, season, episode, title, resumeAt, directUrl, torrent, onProgress, onCompleted, episodeWatched, onToggleWatched, onNext } = props;
  const lastSavedRef = useRef(0);
  const completedRef = useRef(false);
  const [castOpen, setCastOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Captura passiva (estilo Web Video Cast): o iframe do servidor toca normal e o
  // nativo observa o tráfego, ACUMULANDO todos os vídeos detectados (o usuário
  // escolhe qual — resolve anúncio/servidor interno). O escolhido toca no ExoPlayer
  // nativo e fica no cache (reabre direto + retoma de onde parou).
  const [capturedList, setCapturedList] = useState<SniffResult[]>([]);   // vídeos detectados
  const [pickerOpen, setPickerOpen] = useState(false);                   // lista pra escolher
  const [ownStream, setOwnStream] = useState<SniffResult | null>(null);  // escolhido
  const [preferIframe, setPreferIframe] = useState(false);               // ficar no servidor
  const [retry, setRetry] = useState(0);                                 // força recaptura
  const ownRef = useRef<SniffResult | null>(null); ownRef.current = ownStream;
  const prefRef = useRef(false); prefRef.current = preferIframe;
  const playedRef = useRef(false);   // evita reabrir o ExoPlayer em loop

  // Legendas (modo <video>: directUrl/torrent). Stremio OpenSubtitles → .srt → blob VTT.
  const [subsOpen, setSubsOpen] = useState(false);
  const [subList, setSubList] = useState<StremioSubtitle[]>([]);
  const [subVtt, setSubVtt] = useState<string | null>(null);   // blob URL ativo
  const [subId, setSubId] = useState<string | null>(null);     // legenda selecionada (null = off)

  // Modo torrent (WebTorrent): resolve a streamURL de forma assíncrona.
  const [tor, setTor] = useState<{ loading: boolean; url?: string; name?: string; playable?: boolean; id?: string; error?: string }>({ loading: false });
  useEffect(() => {
    if (!open || !torrent) return;
    let alive = true;
    let torrentId: string | undefined;
    setTor({ loading: true });
    getTorrentStream(torrent.magnet, torrent.fileIdx)
      .then(s => { if (alive) { torrentId = s.torrentId; setTor({ loading: false, url: s.url, name: s.name, playable: s.playable, id: s.torrentId }); } })
      .catch(e => { if (alive) setTor({ loading: false, error: e instanceof Error ? e.message : 'Falha ao carregar torrent' }); });
    return () => { alive = false; if (torrentId) destroyTorrent(torrentId); };
  }, [open, torrent]);

  // Buscar legendas PT só no modo <video> (directUrl/torrent) e com imdbId.
  useEffect(() => {
    if (!open || !(directUrl || torrent) || !imdbId) { setSubList([]); return; }
    let alive = true;
    fetchSubtitles({ imdbId, type, season, episode })
      .then(list => { if (alive) setSubList(list); })
      .catch(() => { if (alive) setSubList([]); });
    return () => { alive = false; };
  }, [open, directUrl, torrent, imdbId, type, season, episode]);

  // Trocar legenda ativa: baixa .srt → VTT blob; revoga o anterior.
  const pickSubtitle = async (s: StremioSubtitle | null) => {
    setSubsOpen(false);
    setSubVtt(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setSubId(s?.id ?? null);
    if (!s) return;
    try {
      const blob = await srtUrlToVttBlob(s.url);
      setSubVtt(blob);
    } catch {
      toast.error('Não consegui carregar essa legenda', { description: 'Tente outra opção.' });
      setSubId(null);
    }
  };

  // Cleanup do blob ao desmontar/fechar.
  useEffect(() => () => { setSubVtt(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }, []);

  // Auto-oculta nossos controles após 4s (libera os controles do provedor embaixo).
  // Não esconde enquanto um dropdown (fonte/legenda) está aberto.
  useEffect(() => {
    if (!open || !fullscreen || !controlsVisible || sourceOpen || subsOpen) return;
    const t = setTimeout(() => setControlsVisible(false), 4000);
    return () => clearTimeout(t);
  }, [open, fullscreen, controlsVisible, sourceOpen, subsOpen]);

  // Ao fechar/desmontar o player, restaura orientação e barras do sistema.
  useEffect(() => {
    if (!open) return;
    return () => {
      if (Capacitor.isNativePlatform()) { Immersive.exit().catch(() => {}); }
      else if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
    };
  }, [open]);

  const target: PlayerTarget = { tmdbId, imdbId, type, season, episode };
  const available = PROVIDERS.filter(p => p.build(target));
  // Lembra a fonte escolhida por título (tmdbId+type). Não muda o padrão global.
  const srcKey = `watchmov_src_${tmdbId ?? imdbId}_${type}`;
  const [providerId, setProviderId] = useState(() => {
    try {
      const saved = localStorage.getItem(srcKey);
      if (saved && available.some(p => p.id === saved)) return saved;
    } catch { /* ignore */ }
    return available[0]?.id ?? 'betterflix';
  });
  const provider = available.find(p => p.id === providerId) || available[0];

  const directMode = !!directUrl || !!torrent;

  // URL do embed do servidor (iframe, como hoje).
  let embedUrl: string | null = provider ? provider.build(target) : null;
  if (embedUrl && provider?.id === 'vidapi' && resumeAt && resumeAt > 0) {
    embedUrl += `&resumeAt=${Math.floor(resumeAt)}`;
  }

  // <video> HTML5 = só Stremio/torrent (directMode). O stream capturado nos
  // servidores toca no ExoPlayer nativo (headers Referer + buffer).
  const nativeOwn = isNative() && !!ownStream && !preferIframe && !directMode;
  const videoSrc = torrent ? (tor.url ?? null) : directUrl ? directUrl : null;
  const src: string | null = nativeOwn ? (ownStream?.url ?? null) : directMode ? videoSrc : embedUrl;

  // Ao abrir/trocar de título/fonte: cache → toca direto; senão captura passiva
  // ACUMULANDO todos os vídeos detectados (segue ouvindo até o usuário escolher).
  useEffect(() => {
    if (!open) return;
    setCapturedList([]); setPickerOpen(false); setPreferIframe(false); setOwnStream(null);
    playedRef.current = false;
    if (directMode || !embedUrl || !isNative()) return;

    const cached = getCachedStream(tmdbId, type, season, episode);
    if (cached) { setOwnStream(cached); return; }

    let alive = true;
    let stop = () => {};
    watchStream(r => {
      if (!alive || ownRef.current || prefRef.current) return;
      setCapturedList(prev => prev.some(x => x.url === r.url) ? prev : [...prev, r]);
    }).then(fn => { if (alive) stop = fn; else fn(); });
    return () => { alive = false; stop(); };
  }, [open, embedUrl, directMode, tmdbId, type, season, episode, retry]);

  // Escolhe um stream detectado → fixa no cache e toca no ExoPlayer.
  const chooseStream = (r: SniffResult) => {
    setPickerOpen(false); setPreferIframe(false);
    playedRef.current = false;
    setCachedStream(r, tmdbId, type, season, episode);
    setOwnStream(r);
  };

  // Volta pro servidor pra escolher outro vídeo (limpa a escolha + recaptura).
  const changeSource = () => {
    invalidateStream(tmdbId, type, season, episode);
    setOwnStream(null); setCapturedList([]); setPreferIframe(false);
    playedRef.current = false;
    setRetry(n => n + 1);
  };

  // Abre o ExoPlayer nativo pro stream escolhido (uma vez; [Continuar] reabre).
  useEffect(() => {
    if (!nativeOwn || !ownStream || playedRef.current) return;
    playedRef.current = true;
    const startMs = getCachedStream(tmdbId, type, season, episode)?.positionMs ?? 0;
    playNative({ url: ownStream.url, referer: ownStream.referer, mime: ownStream.mime, title, startMs })
      .then(res => {
        if (res && res.positionMs > 0) {
          setStreamPosition(res.positionMs, tmdbId, type, season, episode);
          onProgress?.(Math.floor(res.positionMs / 1000));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeOwn, ownStream]);

  const continueNative = () => { playedRef.current = false; setOwnStream(s => (s ? { ...s } : s)); };

  // <video> (Stremio/torrent): anexa a fonte (hls.js pra .m3u8; src direto pro resto).
  useEffect(() => {
    const v = videoRef.current;
    if (!open || !directMode || !videoSrc || !v) return;
    const isHls = /\.m3u8(\?|$)/i.test(videoSrc);
    let hls: Hls | null = null;
    if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(videoSrc);
      hls.attachMedia(v);
    } else {
      v.src = videoSrc;
    }
    return () => { if (hls) hls.destroy(); };
  }, [open, directMode, videoSrc]);

  useEffect(() => {
    if (!open) return;
    completedRef.current = false;
    lastSavedRef.current = resumeAt ?? 0;

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'PLAYER_EVENT' || !data.data) return;
      const { player_status, player_progress } = data.data as { player_status?: string; player_progress?: number };
      const secs = typeof player_progress === 'number' ? player_progress : 0;
      if (player_status === 'completed') {
        if (!completedRef.current) { completedRef.current = true; onCompleted?.(); }
        return;
      }
      if (secs > 0 && Math.abs(secs - lastSavedRef.current) >= 30) {
        lastSavedRef.current = secs;
        onProgress?.(secs);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerId, season, episode]);

  if (!open) return null;

  const qrUrl = src ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(src)}` : '';

  const tryCast = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await ScreenCast.openCast();
        toast.info('Selecione sua TV', { description: 'Escolha a TV na lista de transmissão do Android.' });
        return;
      } catch { setCastOpen(true); return; }
    }
    const w = window as unknown as { PresentationRequest?: new (urls: string[]) => { start: () => Promise<unknown> } };
    if (typeof w.PresentationRequest === 'function') {
      try { await new w.PresentationRequest([src!]).start(); toast.success('Transmitindo para a TV'); return; } catch { /* fallback */ }
    }
    setCastOpen(true);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(src!); toast.success('Link copiado', { description: 'Cole no navegador da sua TV LG.' }); }
    catch { toast.error('Não foi possível copiar', { description: src || '' }); }
  };

  const pickSource = (id: string) => {
    setProviderId(id);
    try { localStorage.setItem(srcKey, id); } catch { /* ignore */ }
    setSourceOpen(false);
    completedRef.current = false;
    lastSavedRef.current = 0;
  };

  // Tela cheia imersiva (oculta barras + entalhe). Nativo: plugin; web: Fullscreen API.
  const toggleFullscreen = async () => {
    const next = !fullscreen;
    setFullscreen(next);
    setControlsVisible(!next); // em tela cheia começa sem a barra; tap mostra
    if (Capacitor.isNativePlatform()) {
      try { await (next ? Immersive.enter() : Immersive.exit()); } catch { /* ignore */ }
      return;
    }
    try {
      if (next) await rootRef.current?.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* ignore */ }
  };

  return (
    <div ref={rootRef} className={`fixed inset-0 z-[60] bg-black animate-fade-in ${fullscreen ? '' : 'flex flex-col'}`}>
      {/* Em tela cheia (paisagem): faixa fina revela os controles ocultos. */}
      {fullscreen && !controlsVisible && (
        <button aria-hidden onClick={() => setControlsVisible(true)} className="absolute top-0 inset-x-0 h-12 z-10" />
      )}
      {/* Retrato: barra fixa no topo (vídeo abaixo, sem sobrepor controles do provedor).
          Tela cheia: overlay translúcido com auto-ocultar. */}
      <div className={fullscreen
        ? `absolute top-0 inset-x-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/90 via-black/70 to-transparent transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
        : 'relative z-20 shrink-0 flex items-center justify-between px-3 py-2 bg-black/95'}>
        <span className="text-sm text-white/90 truncate flex-1">{title || 'Player'}</span>
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative" hidden={directMode}>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Trocar fonte" onClick={() => setSourceOpen(o => !o)}>
              <Layers className="w-5 h-5" />
            </Button>
            {!directMode && sourceOpen && (
              <div className="fixed left-1/2 -translate-x-1/2 top-14 z-30 bg-card border border-border rounded-lg py-1 w-56 max-w-[90vw] shadow-xl">
                <p className="px-3 py-1 text-[10px] text-muted-foreground">Fontes (troque se estiver em inglês ou não carregar)</p>
                {available.map(p => (
                  <button key={p.id} onClick={() => pickSource(p.id)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    {p.name}
                    {p.id === providerId && <Check className="w-4 h-4 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {directMode && (
            <div className="relative">
              <Button variant="ghost" size="icon" className={`h-9 w-9 hover:text-white hover:bg-white/10 ${subId ? 'text-primary' : 'text-white/80'}`} title="Legendas" onClick={() => setSubsOpen(o => !o)}>
                <Subtitles className="w-5 h-5" />
              </Button>
              {subsOpen && (
                <div className="absolute right-0 top-11 z-20 bg-card border border-border rounded-lg py-1 w-52 shadow-xl max-h-72 overflow-auto">
                  <p className="px-3 py-1 text-[10px] text-muted-foreground">Legendas {subList.length ? `(${subList.length})` : '— buscando/sem PT'}</p>
                  <button onClick={() => pickSubtitle(null)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    Desligada {subId === null && <Check className="w-4 h-4 text-primary" />}
                  </button>
                  {subList.map(s => (
                    <button key={s.id} onClick={() => pickSubtitle(s)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-secondary">
                      <span className="truncate">{s.label}</span>
                      {s.id === subId && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {onToggleWatched && (
            <Button variant="ghost" size="icon" className={`h-9 w-9 hover:text-white hover:bg-white/10 ${episodeWatched ? 'text-primary' : 'text-white/80'}`} title={episodeWatched ? 'Assistido (toque pra desmarcar)' : 'Marcar como assistido'} onClick={onToggleWatched}>
              {episodeWatched ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
            </Button>
          )}
          {onNext && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Próximo episódio" onClick={onNext}>
              <SkipForward className="w-5 h-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Espelhar para TV" onClick={tryCast}>
            <Tv className="w-5 h-5" />
          </Button>
          {fullscreen && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Ocultar controles" onClick={() => setControlsVisible(false)}>
              <ChevronUp className="w-5 h-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className={fullscreen ? 'absolute inset-0' : 'flex-1 min-h-0'}>
        {torrent && tor.loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80 text-sm px-6 text-center">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p>Conectando a peers (WebTorrent)…</p>
            <p className="text-white/50 text-xs">Pode levar alguns segundos. Depende de seeders WebRTC disponíveis.</p>
          </div>
        ) : torrent && tor.error ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80 text-sm px-6 text-center">
            <p className="text-amber-400">{tor.error}</p>
            <p className="text-white/50 text-xs">Torrents só tocam aqui com seeders WebRTC e formato MP4/WebM. Tente outra opção, ou abra no Stremio.</p>
          </div>
        ) : torrent && tor.url && tor.playable === false ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80 text-sm px-6 text-center">
            <p className="text-amber-400">Formato não suportado no navegador: {tor.name}</p>
            <p className="text-white/50 text-xs">O navegador só decodifica MP4 (H.264) e WebM. Este arquivo (provável .mkv/.avi) não toca aqui — escolha uma opção MP4 ou abra no Stremio.</p>
          </div>
        ) : nativeOwn ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-white/80 text-sm px-6 text-center">
            <Sparkles className="w-8 h-8 text-primary" />
            <p className="text-white">Tocando no seu player</p>
            <p className="text-white/50 text-xs">Fechou o player? Use os botões abaixo.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button size="sm" onClick={continueNative}>Continuar</Button>
              <Button size="sm" variant="outline" onClick={changeSource}>Trocar vídeo</Button>
              <Button size="sm" variant="ghost" className="text-white/70" onClick={() => setPreferIframe(true)}>Servidor</Button>
            </div>
          </div>
        ) : !src ? (
          <div className="w-full h-full flex items-center justify-center text-white/70 text-sm">Sem fonte disponível para este título.</div>
        ) : directMode ? (
          <video
            ref={videoRef}
            key={videoSrc ?? 'video'}
            className="w-full h-full bg-black"
            controls
            autoPlay
            playsInline
            onLoadedMetadata={e => {
              if (resumeAt && resumeAt > 0 && resumeAt < e.currentTarget.duration - 5) {
                e.currentTarget.currentTime = resumeAt;
              }
            }}
            onTimeUpdate={e => {
              const secs = Math.floor(e.currentTarget.currentTime);
              if (secs > 0 && Math.abs(secs - lastSavedRef.current) >= 30) { lastSavedRef.current = secs; onProgress?.(secs); }
            }}
            onEnded={() => { if (!completedRef.current) { completedRef.current = true; onCompleted?.(); } }}
          >
            {subVtt && <track kind="subtitles" src={subVtt} srcLang="pt" label="Português" default />}
          </video>
        ) : (
          <iframe
            key={src}
            src={src}
            title={title || 'VideoPlayer'}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="origin"
          />
        )}
      </div>

      {/* Banner: vídeo(s) capturado(s) em background enquanto assiste no servidor. */}
      {!directMode && !nativeOwn && !preferIframe && capturedList.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-30 w-[92%] max-w-md bg-card border border-primary/40 rounded-xl shadow-2xl p-3 flex items-center gap-3 animate-fade-in">
          <Sparkles className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{capturedList.length === 1 ? 'Vídeo pronto no seu player' : `${capturedList.length} vídeos detectados`}</p>
            <p className="text-xs text-muted-foreground">Controles, buffer e (em breve) espelhar/baixar.</p>
          </div>
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setPreferIframe(true)}>Servidor</Button>
          <Button size="sm" className="shrink-0" onClick={() => capturedList.length === 1 ? chooseStream(capturedList[0]) : setPickerOpen(true)}>
            {capturedList.length === 1 ? 'Reproduzir' : 'Escolher'}
          </Button>
        </div>
      )}

      {/* Lista de vídeos detectados (escolher qual reproduzir). */}
      {pickerOpen && (
        <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[70vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border sticky top-0 bg-card">
              <h3 className="font-semibold text-foreground text-sm">Vídeos detectados ({capturedList.length})</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPickerOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            {capturedList.map((s, i) => (
              <button key={s.url} onClick={() => chooseStream(s)} className="w-full text-left px-3 py-2.5 hover:bg-secondary border-b border-border/40">
                <p className="text-sm text-foreground">Vídeo {i + 1} <span className="text-[10px] text-muted-foreground">({s.mime?.includes('mpegurl') ? 'HLS' : s.mime?.includes('dash') ? 'DASH' : 'MP4'})</span></p>
                <p className="text-[11px] text-muted-foreground truncate">{s.url}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {castOpen && (
        <div className="absolute inset-0 z-10 bg-black/80 flex items-end sm:items-center justify-center p-4" onClick={() => setCastOpen(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Tv className="w-4 h-4" /> Espelhar para TV</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCastOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> Espelhamento de tela (TV LG, Samsung etc.)</p>
              <p className="text-xs text-muted-foreground">No celular, abra <b>Espelhamento de tela</b> / <b>Smart View</b> e selecione sua TV LG. Depois volte aqui e dê play.</p>
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs text-muted-foreground">Ou abra direto no navegador da TV LG (webOS):</p>
              <div className="flex justify-center"><img src={qrUrl} alt="QR do link" className="rounded-lg bg-white p-1" width={160} height={160} /></div>
              <Button variant="outline" size="sm" className="w-full" onClick={copyLink}><Copy className="w-4 h-4 mr-1" /> Copiar link</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
