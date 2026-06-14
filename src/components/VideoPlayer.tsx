import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, ExternalLink, Tv, Copy, Smartphone, Layers, Check } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { toast } from 'sonner';
import { PROVIDERS, type PlayerTarget } from '@/lib/players';

interface ScreenCastPlugin { openCast(): Promise<void>; }
const ScreenCast = registerPlugin<ScreenCastPlugin>('ScreenCast');

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
  onProgress?: (seconds: number) => void;
  onCompleted?: () => void;
}

export default function VideoPlayer(props: VideoPlayerProps) {
  const { open, onClose, tmdbId, imdbId, type, season, episode, title, resumeAt, onProgress, onCompleted } = props;
  const lastSavedRef = useRef(0);
  const completedRef = useRef(false);
  const [castOpen, setCastOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const target: PlayerTarget = { tmdbId, imdbId, type, season, episode };
  const available = PROVIDERS.filter(p => p.build(target));
  const [providerId, setProviderId] = useState(available[0]?.id ?? 'vidapi');
  const provider = available.find(p => p.id === providerId) || available[0];

  let src = provider ? provider.build(target) : null;
  if (src && provider?.id === 'vidapi' && resumeAt && resumeAt > 0) {
    src += `&resumeAt=${Math.floor(resumeAt)}`;
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

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 bg-black/90 shrink-0">
        <span className="text-sm text-white/90 truncate flex-1">{title || 'Player'}</span>
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Trocar fonte" onClick={() => setSourceOpen(o => !o)}>
              <Layers className="w-5 h-5" />
            </Button>
            {sourceOpen && (
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

      <div className="flex-1 min-h-0">
        {src ? (
          <iframe
            key={src}
            src={src}
            title={title || 'VideoPlayer'}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/70 text-sm">Sem fonte disponível para este título.</div>
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
