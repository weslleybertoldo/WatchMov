import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Bug, Folder, Tv, Film, ChevronRight, CalendarDays, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import {
  toEntries, rootFolders, subFolders, folderRows, kindOf, isRealError, fmtDay, rangeBounds,
  type Folder as BugFolder,
} from '@/lib/bugsFolders';

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

// "Últimos 10" em cada nível (pastas e registros) + botão "Ver mais".
const PAGE = 10;
// Teto de registros por consulta — o filtro por data alcança os mais antigos.
const LIMIT = 1000;

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export default function BugsView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<PlaybackError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filtro por data (dias locais, inclusivos) — vai pro banco, não só pra tela.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Pasta aberta: show = título (série/filme); sub = episódio (série) ou dia (filme).
  const [show, setShow] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  // Nº da consulta em voo: trocar o filtro rápido dispara 2 consultas e a resposta da
  // ANTIGA pode chegar depois da nova — sem isto ela sobrescrevia a lista filtrada.
  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqSeq.current;
    setLoading(true);
    setError(null);
    let q = supabase.from('wm_playback_errors').select('*').order('created_at', { ascending: false }).limit(LIMIT);
    const b = rangeBounds(from, to);
    if (b.from) q = q.gte('created_at', b.from);
    if (b.toExclusive) q = q.lt('created_at', b.toExclusive);
    const { data, error } = await q;
    if (id !== reqSeq.current) return;   // veio consulta mais nova; descarta esta
    if (error) setError(error.message);
    else setRows((data ?? []) as PlaybackError[]);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);
  // Trocou de pasta ou de filtro → volta pros primeiros 10.
  useEffect(() => { setShown(PAGE); }, [show, sub, from, to]);

  // Voltar (seta e botão do Android): sobe um nível; na raiz fecha a aba. O handler
  // do Index (que fecha a aba) só roda quando este devolve false.
  const up = useCallback((): boolean => {
    if (sub) { setSub(null); return true; }
    if (show) { setShow(null); return true; }
    return false;
  }, [sub, show]);
  useAndroidBackButton(up);
  const goBack = () => { if (!up()) onBack(); };

  const entries = useMemo(() => toEntries(rows), [rows]);
  const roots = useMemo(() => rootFolders(entries), [entries]);
  const showKind = useMemo(() => (show ? kindOf(entries, show) : null), [entries, show]);
  const subs = useMemo(() => (show ? subFolders(entries, show) : []), [entries, show]);
  const reports = useMemo(() => (show && sub ? folderRows(entries, show, sub) : []), [entries, show, sub]);

  const folders: BugFolder[] = sub ? [] : show ? subs : roots;
  const total = sub ? reports.length : folders.length;
  const subLabel = sub ? (showKind === 'movie' ? fmtDay(sub) : sub) : null;

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
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={goBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold flex items-center gap-2 min-w-0">
          <Bug className="w-5 h-5 text-primary shrink-0" />
          <span className="truncate">{subLabel ?? show ?? 'Bugs'}</span>
        </h1>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Atualizar" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
          {!show && rows.length > 0 && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Limpar tudo" onClick={clearAll}><Trash2 className="w-4 h-4" /></Button>
          )}
        </div>
      </div>

      {show ? (
        // Trilha: Bugs › Série › T1 E49 — cada parte volta pro nível dela.
        <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0" aria-label="Pasta atual">
          <button type="button" className="hover:text-foreground shrink-0" onClick={() => { setSub(null); setShow(null); }}>Bugs</button>
          <ChevronRight className="w-3 h-3 shrink-0" />
          {sub ? (
            <>
              <button type="button" className="hover:text-foreground truncate max-w-[55%]" onClick={() => setSub(null)}>{show}</button>
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span className="text-foreground shrink-0">{subLabel}</span>
            </>
          ) : (
            <span className="text-foreground truncate">{show}</span>
          )}
        </nav>
      ) : (
        <p className="text-xs text-muted-foreground">
          Registro dos erros de reprodução (player nativo), em pastas por título: série → episódio → registros; filme → dia → registros.
        </p>
      )}

      <div className="flex items-center gap-2 text-xs flex-wrap">
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <label className="flex items-center gap-1 text-muted-foreground">De
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} aria-label="Data inicial"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground [color-scheme:dark]" />
        </label>
        <label className="flex items-center gap-1 text-muted-foreground">Até
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} aria-label="Data final"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground [color-scheme:dark]" />
        </label>
        {(from || to) && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setFrom(''); setTo(''); }}>
            <X className="w-3 h-3 mr-1" /> Limpar filtro
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-destructive py-8 text-center">Falha ao carregar: {error}</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {from || to ? 'Nenhum registro no período.' : show ? 'Pasta vazia.' : 'Nenhum erro registrado. 🎉'}
        </p>
      ) : (
        <div className="space-y-2">
          {sub
            ? reports.slice(0, shown).map(r => <ReportCard key={r.id} r={r} />)
            : folders.slice(0, shown).map(f => (
                <FolderRow key={f.key} f={f} onOpen={() => (show ? setSub(f.key) : setShow(f.key))} />
              ))}
          {total > shown && (
            <Button variant="secondary" className="w-full h-9 text-xs" onClick={() => setShown(s => s + PAGE)}>
              Ver mais ({total - shown} restantes)
            </Button>
          )}
          {!show && rows.length >= LIMIT && (
            <p className="text-[11px] text-muted-foreground text-center">
              Mostrando os {LIMIT} registros mais recentes — use o filtro por data pra ver os anteriores.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FolderRow({ f, onOpen }: { f: BugFolder; onOpen: () => void }) {
  const Icon = f.kind === 'tv' ? Tv : f.kind === 'movie' ? Film : Folder;
  const subs = f.kind === 'tv' ? plural(f.subs, 'episódio', 'episódios') : f.kind === 'movie' ? plural(f.subs, 'dia', 'dias') : null;
  return (
    <button type="button" onClick={onOpen} data-testid="bug-folder"
      className="w-full text-left bg-card border border-border/60 rounded-lg p-3 flex items-center gap-3 hover:bg-secondary/50 active:scale-[0.99] transition">
      <Icon className="w-5 h-5 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm text-foreground truncate">{f.label}</div>
        <div className="flex flex-wrap gap-1.5 mt-1 text-[11px]">
          {subs && <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{subs}</span>}
          <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{plural(f.count, 'registro', 'registros')}</span>
          {f.errors > 0
            ? <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">{plural(f.errors, 'erro', 'erros')}</span>
            : <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">sem erro</span>}
        </div>
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">{fmtWhen(f.last)}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

function ReportCard({ r }: { r: PlaybackError }) {
  const real = isRealError(r);
  return (
    <div data-testid="bug-report" data-error={real ? '1' : '0'}
      className={`bg-card border border-border/60 rounded-lg p-3 text-xs space-y-1 ${real ? 'border-l-2 border-l-destructive' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground truncate">{r.title || 'Sem título'}</span>
        <span className="text-muted-foreground shrink-0">{fmtWhen(r.created_at)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {r.provider && <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{r.provider}</span>}
        {r.error_name && (
          <span className={`px-1.5 py-0.5 rounded ${real ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground'}`}>
            {r.error_name}{r.error_code != null ? ` (${r.error_code})` : ''}
          </span>
        )}
        {r.mime && <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{r.mime}</span>}
        {r.app_version && <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">v{r.app_version}</span>}
      </div>
      {r.error_cause && <p className="text-amber-400 break-words">{r.error_cause}</p>}
      {r.url && <p className="text-muted-foreground break-all leading-tight">{r.url}</p>}
    </div>
  );
}
