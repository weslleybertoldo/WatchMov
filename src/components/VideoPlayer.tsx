import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, ExternalLink, Tv, Copy, Smartphone } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { toast } from 'sonner';

interface ScreenCastPlugin { openCast(): Promise<void>; }
const ScreenCast = registerPlugin<ScreenCastPlugin>('ScreenCast');

interface VideoPlayerProps {
  open: boolean;
  onClose: () => void;
  mediaId: string;            // imdbId (tt...) ou tmdbId
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  resumeAt?: number;          // segundos
  onProgress?: (seconds: number) => void;
  onCompleted?: () => void;
}

const VIDAPI_BASE = 'https://vaplayer.ru/embed';

function buildUrl({ mediaId, type, season, episode, resumeAt }: VideoPlayerProps): string {
  let url = type === 'movie'
    ? `${VIDAPI_BASE}/movie/${mediaId}`
    : `${VIDAPI_BASE}/tv/${mediaId}/${season ?? 1}/${episode ?? 1}`;
  const params = new URLSearchParams({ autoplay: '1' });
  // Legenda PT-BR por padrão (auto-busca OpenSubtitles). Áudio dublado não é
  // controlável pela API do VidAPI — depende da fonte; troca-se nos controles do player.
  params.set('ds_lang', 'pt');
  params.set('sub_lang', 'pt');
  if (resumeAt && resumeAt > 0) params.set('resumeAt', String(Math.floor(resumeAt)));
  return `${url}?${params.toString()}`;
}

export default function VideoPlayer(props: VideoPlayerProps) {
  const { open, onClose, mediaId, type, title, onProgress, onCompleted } = props;
  const lastSavedRef = useRef(0);
  const completedRef = useRef(false);
  const [castOpen, setCastOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    completedRef.current = false;
    lastSavedRef.current = props.resumeAt ?? 0;

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'PLAYER_EVENT' || !data.data) return;
      const { player_status, player_progress } = data.data as {
        player_status?: string;
        player_progress?: number;
      };
      const secs = typeof player_progress === 'number' ? player_progress : 0;

      if (player_status === 'completed') {
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleted?.();
        }
        return;
      }
      // playing/paused/seeked → salva progresso com throttle de ~30s
      if (secs > 0 && Math.abs(secs - lastSavedRef.current) >= 30) {
        lastSavedRef.current = secs;
        onProgress?.(secs);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mediaId, type, props.season, props.episode]);

  if (!open) return null;

  const src = buildUrl(props);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(src)}`;

  const tryCast = async () => {
    // No Android nativo: abre o seletor de transmissão do sistema (busca a TV LG
    // e espelha a tela inteira, incluindo o player).
    if (Capacitor.isNativePlatform()) {
      try {
        await ScreenCast.openCast();
        toast.info('Selecione sua TV', { description: 'Escolha a TV na lista de transmissão do Android.' });
        return;
      } catch {
        setCastOpen(true);
        return;
      }
    }
    // Web: tenta Presentation API (Chromecast/displays no Chrome), senão sheet
    const w = window as unknown as { PresentationRequest?: new (urls: string[]) => { start: () => Promise<unknown> } };
    if (typeof w.PresentationRequest === 'function') {
      try {
        await new w.PresentationRequest([src]).start();
        toast.success('Transmitindo para a TV');
        return;
      } catch {
        // usuário cancelou ou sem dispositivo — cai pro sheet
      }
    }
    setCastOpen(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(src);
      toast.success('Link copiado', { description: 'Cole no navegador da sua TV LG.' });
    } catch {
      toast.error('Não foi possível copiar', { description: src });
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 bg-black/90 shrink-0">
        <span className="text-sm text-white/90 truncate">{title || 'Player'}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10"
            title="Espelhar para TV"
            onClick={tryCast}
          >
            <Tv className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10"
            title="Abrir no navegador"
            onClick={() => Browser.open({ url: src })}
          >
            <ExternalLink className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <iframe
          src={src}
          title={title || 'VideoPlayer'}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          // Bloqueia popups/redirects do agregador, mantendo o player funcional
          sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
        />
      </div>

      {/* Sheet: espelhar para TV (incl. LG) */}
      {castOpen && (
        <div className="absolute inset-0 z-10 bg-black/80 flex items-end sm:items-center justify-center p-4" onClick={() => setCastOpen(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Tv className="w-4 h-4" /> Espelhar para TV</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCastOpen(false)}><X className="w-4 h-4" /></Button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" /> Espelhamento de tela (TV LG, Samsung etc.)
              </p>
              <p className="text-xs text-muted-foreground">
                No celular, abra <b>Espelhamento de tela</b> / <b>Smart View</b> (atalhos rápidos do Android) e selecione sua TV LG. Depois volte aqui e dê play.
              </p>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs text-muted-foreground">Ou abra direto no navegador da TV LG (webOS):</p>
              <div className="flex justify-center">
                <img src={qrUrl} alt="QR do link" className="rounded-lg bg-white p-1" width={160} height={160} />
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={copyLink}>
                <Copy className="w-4 h-4 mr-1" /> Copiar link
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
