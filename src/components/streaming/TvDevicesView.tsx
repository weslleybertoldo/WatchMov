import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Plus, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { listTvDevices, requestTvApprove, TV_APPROVED_EVENT, type TvDevice } from '@/lib/tvPair';

// Painel → Entrar na TV (pedido dele 26/09/2026): as TVs conectadas nesta conta e o "Conectar +",
// que abre o campo do código que a TV mostra.
function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return hoje ? `hoje ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

export default function TvDevicesView({ onBack }: { onBack: () => void }) {
  const [devices, setDevices] = useState<TvDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    try {
      setDevices(await listTvDevices(token));
      setError(null);
    } catch {
      setError('Não deu pra carregar as TVs. Tente de novo.');
      setDevices((d) => d ?? []);
    }
  }, []);

  useEffect(() => {
    load();
    // A TV se anota uns segundos DEPOIS de entrar: recarrega agora e de novo em seguida.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onApproved = () => { load(); timers.push(setTimeout(load, 4000), setTimeout(load, 10000)); };
    window.addEventListener(TV_APPROVED_EVENT, onApproved);
    return () => { window.removeEventListener(TV_APPROVED_EVENT, onApproved); timers.forEach(clearTimeout); };
  }, [load]);

  return (
    <div className="space-y-6 animate-fade-in max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold">Entrar na TV</h1>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">TVs conectadas</h2>
        {devices === null ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nenhuma TV conectada ainda.</p>
        ) : (
          devices.map((d) => (
            <div key={d.session_id} className="bg-card border border-border/60 rounded-xl p-4 flex items-center gap-3">
              <Tv className="w-6 h-6 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{d.name}{d.model ? <span className="text-muted-foreground font-normal"> · {d.model}</span> : null}</p>
                <p className="text-xs text-muted-foreground">Conectada {quando(d.created_at)} · usada {quando(d.last_seen_at)}</p>
              </div>
            </div>
          ))
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <Button className="w-full gap-2 h-11" onClick={() => requestTvApprove()}>
        Conectar <Plus className="w-4 h-4" />
      </Button>
      <p className="text-xs text-muted-foreground text-center">Abra o WatchMov na TV e digite o código que aparece nela (ou aponte a câmera pro QR).</p>
    </div>
  );
}
