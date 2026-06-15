import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, ExternalLink, Tv, Copy, Smartphone, Layers, Check, Loader2, Subtitles, RotateCw, Maximize, Minimize, CheckSquare, Square } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { toast } from 'sonner';
import { PROVIDERS, type PlayerTarget } from '@/lib/players';
import { getTorrentStream, destroyTorrent } from '@/lib/torrentClient';
import { fetchSubtitles, srtUrlToVttBlob, type StremioSubtitle } from '@/lib/stremio';

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
}

export default function VideoPlayer(props: VideoPlayerProps) {
  const { open, onClose, tmdbId, imdbId, type, season, episode, title, resumeAt, directUrl, torrent, onProgress, onCompleted, episodeWatched, onToggleWatched } = props;
  const lastSavedRef = useRef(0);
  const completedRef = useRef(false);
  const [castOpen, setCastOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

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
  const [providerId, setProviderId] = useState(available[0]?.id ?? 'vidapi');
  const provider = available.find(p => p.id === providerId) || available[0];

  const directMode = !!directUrl || !!torrent;
  let src: string | null;
  if (torrent) {
    src = tor.url ?? null;
  } else if (directUrl) {
    src = directUrl;
  } else {
    src = provider ? provider.build(target) : null;
    if (src && provider?.id === 'vidapi' && resumeAt && resumeAt > 0) {
      src += `&resumeAt=${Math.floor(resumeAt)}`;
    }
  }

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
    setSourceOpen(false);
    completedRef.current = false;
    lastSavedRef.current = 0;
  };

  // Girar a tela (retrato/paisagem). Nativo: SO; web: Screen Orientation API (best-effort).
  const rotate = async () => {
    if (Capacitor.isNativePlatform()) { try { await Immersive.toggleOrientation(); } catch { /* ignore */ } return; }
    const so = (screen as unknown as { orientation?: { type: string; lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
    try {
      if (so?.lock) { await (so.type.startsWith('landscape') ? Promise.resolve(so.unlock?.()) : so.lock('landscape')); }
    } catch { /* orientação travada/sem suporte */ }
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
    <div ref={rootRef} className="fixed inset-0 z-[60] bg-black animate-fade-in">
      {/* Zona de toque (topo) pra mostrar/ocultar os controles sobre o player. */}
      <button aria-hidden onClick={() => setControlsVisible(v => !v)} className="absolute top-0 inset-x-0 h-24 z-10" />
      <div className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/90 via-black/70 to-transparent transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <span className="text-sm text-white/90 truncate flex-1">{title || 'Player'}</span>
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative" hidden={directMode}>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Trocar fonte" onClick={() => setSourceOpen(o => !o)}>
              <Layers className="w-5 h-5" />
            </Button>
            {!directMode && sourceOpen && (
              <div className="absolute right-0 top-11 z-20 bg-card border border-border rounded-lg py-1 w-48 shadow-xl">
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
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Girar tela" onClick={rotate}>
            <RotateCw className="w-5 h-5" />
          </Button>
          {directMode && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Espelhar para TV" onClick={tryCast}>
            <Tv className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Abrir no navegador" onClick={() => src && Browser.open({ url: src })}>
            <ExternalLink className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="absolute inset-0">
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
        ) : !src ? (
          <div className="w-full h-full flex items-center justify-center text-white/70 text-sm">Sem fonte disponível para este título.</div>
        ) : directMode ? (
          <video
            key={src}
            src={src}
            className="w-full h-full bg-black"
            controls
            autoPlay
            playsInline
            onLoadedMetadata={e => {
              // "Continuar de onde parou" no player nativo (Stremio/torrent).
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
