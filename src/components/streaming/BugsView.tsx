import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

interface PlaybackError {
  id: string;
  created_at: string;
  title: string | null;
  provider: string | null;
  url: string | null;
  referer: string | null;
  mime: string | null;
  error_code: number | null;
  error_name: string | null;
  error_cause: string | null;
  app_version: string | null;
}

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function BugsView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<PlaybackError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('wm_playback_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) setError(error.message);
    else setRows((data ?? []) as PlaybackError[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearAll = async () => {
    if (!rows.length) return;
    // apaga só os próprios (RLS) — usa um filtro sempre-verdadeiro
    const { error } = await supabase.from('wm_playback_errors').delete().not('id', 'is', null);
    if (error) { setError(error.message); return; }
    setRows([]);
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold flex items-center gap-2"><Bug className="w-5 h-5 text-primary" /> Bugs</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Atualizar" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
          {rows.length > 0 && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Limpar tudo" onClick={clearAll}><Trash2 className="w-4 h-4" /></Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Registro dos erros de reprodução (player nativo). Mostra o motivo real de cada link que não abriu.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-destructive py-8 text-center">Falha ao carregar: {error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum erro registrado. 🎉</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="bg-card border border-border/60 rounded-lg p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground truncate">{r.title || 'Sem título'}</span>
                <span className="text-muted-foreground shrink-0">{fmtWhen(r.created_at)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.provider && <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{r.provider}</span>}
                {r.error_name && <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">{r.error_name}{r.error_code != null ? ` (${r.error_code})` : ''}</span>}
                {r.mime && <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{r.mime}</span>}
                {r.app_version && <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">v{r.app_version}</span>}
              </div>
              {r.error_cause && <p className="text-amber-400 break-words">{r.error_cause}</p>}
              {r.url && <p className="text-muted-foreground break-all leading-tight">{r.url}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
