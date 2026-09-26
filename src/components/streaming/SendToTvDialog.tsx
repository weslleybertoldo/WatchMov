import { useEffect, useState } from 'react';
import { Cast, Loader2, Plus, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { listTvDevices, requestTvApprove, type TvDevice } from '@/lib/tvPair';
import { newCmdId, sendToTv } from '@/lib/tvRemote';
import type { MediaSummary } from '@/lib/tmdb';

export const MSG_TV_DESLIGADA = 'Falha na comunicação, dispositivo desligado';
const MSG_SEM_CONEXAO = 'Sem conexão. Tente de novo.';

// Tela do título → ícone de espelhar (pedido dele 26/09/2026): lista as TVs da conta; tocou numa, a TV abre a
// página deste título. Círculo girando até a TV responder; sem resposta, a TV está desligada (ou com o app fechado).
export default function SendToTvDialog({ media, open, onOpenChange }: {
  media: MediaSummary;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [devices, setDevices] = useState<TvDevice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDevices(null);
    setLoadError(null);
    setFailed({});
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { if (alive) { setDevices([]); setLoadError('Entre no app primeiro.'); } return; }
      try {
        const list = await listTvDevices(token);
        if (alive) setDevices(list);
      } catch {
        if (alive) { setDevices([]); setLoadError('Não deu pra carregar as TVs. Tente de novo.'); }
      }
    })();
    return () => { alive = false; };
  }, [open]);

  const send = async (d: TvDevice) => {
    if (sending) return;
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) { setFailed(f => ({ ...f, [d.session_id]: MSG_SEM_CONEXAO })); return; }
    setSending(d.session_id);
    setFailed(f => { const n = { ...f }; delete n[d.session_id]; return n; });
    const r = await sendToTv(uid, {
      id: newCmdId(), to: d.session_id, action: 'open',
      media: {
        tmdbId: media.tmdbId, type: media.type, title: media.title, posterUrl: media.posterUrl,
        backdropUrl: media.backdropUrl, rating: media.rating, votes: media.votes, year: media.year, date: media.date,
      },
    }).catch(() => 'offline' as const);
    setSending(null);
    if (r === 'ok') {
      onOpenChange(false);
      toast.success(`Abrindo na ${d.name}`, { description: media.title });
      return;
    }
    setFailed(f => ({ ...f, [d.session_id]: r === 'no_answer' ? MSG_TV_DESLIGADA : MSG_SEM_CONEXAO }));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cast className="w-5 h-5 text-primary" /> Abrir na TV</DialogTitle>
          <DialogDescription className="truncate">{media.title}</DialogDescription>
        </DialogHeader>
        {devices === null ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : devices.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{loadError ?? 'Nenhuma TV conectada ainda.'}</p>
            {!loadError && (
              <Button variant="outline" className="w-full gap-2" onClick={() => { onOpenChange(false); requestTvApprove(); }}>
                Conectar TV <Plus className="w-4 h-4" />
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => {
              const busy = sending === d.session_id;
              const erro = failed[d.session_id];
              return (
                <button key={d.session_id} type="button" onClick={() => send(d)} disabled={!!sending && !busy}
                  data-tv-send={d.session_id}
                  className="w-full text-left bg-card border border-border/60 rounded-xl p-3 flex items-center gap-3 hover:border-primary disabled:opacity-50">
                  <Tv className="w-6 h-6 text-primary shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground truncate">{d.name}</span>
                    {busy ? (
                      <span className="block text-xs text-muted-foreground">Esperando a TV responder…</span>
                    ) : erro ? (
                      <span className="block text-xs text-destructive" role="alert">{erro}</span>
                    ) : d.model ? (
                      <span className="block text-xs text-muted-foreground truncate">{d.model}</span>
                    ) : null}
                  </span>
                  {busy && <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" aria-label="Enviando" />}
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
