import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trash2, DownloadCloud, Tv, AlertCircle, Sparkles } from 'lucide-react';
import { useNotices, markAllRead, clearNotices, noticeWhen, type NoticeKind } from '@/lib/appNotices';
import { useMp4All } from '@/lib/mp4Download';
import { useDownloadList, type DownloadMeta } from '@/lib/downloads';

const TABS: { key: NoticeKind; label: string; empty: string }[] = [
  { key: 'release', label: 'Lançamentos', empty: 'Nada lançado ainda. Ligue o sino num título pra ser avisado quando estrear ou sair episódio novo.' },
  { key: 'download', label: 'Downloads', empty: 'Nenhum download concluído por aqui ainda.' },
  { key: 'mp4', label: 'Conversões', empty: 'Nenhuma conversão pra MP4 ainda.' },
];

// "Título — T2E5" a partir do registro local (ou do que o download guardou).
function nomeDe(meta: Record<string, DownloadMeta>, key: string, fallback?: string): string {
  const m = meta[key];
  const base = m?.title || fallback || 'Vídeo';
  return m && m.season != null && m.ep != null ? `${base} — T${m.season}E${m.ep}` : base;
}

function Icon({ kind, error }: { kind: NoticeKind; error?: boolean }) {
  if (error) return <AlertCircle className="w-4 h-4 text-destructive" />;
  if (kind === 'download') return <DownloadCloud className="w-4 h-4 text-primary" />;
  if (kind === 'mp4') return <Tv className="w-4 h-4 text-green-400" />;
  return <Sparkles className="w-4 h-4 text-primary" />;
}

// Histórico dos avisos que passaram como toast, separado por assunto.
export default function NoticesView({ onBack }: { onBack: () => void }) {
  const { list } = useNotices();
  const [tab, setTab] = useState<NoticeKind>('release');
  // Conversões/downloads de MP4 rodando agora (progresso ao vivo).
  // Conversão (o vídeo já estava baixado) vai pra aba Conversões; baixar já em MP4
  // é download, então aparece na aba Downloads junto dos downloads normais.
  const mp4Todos = useMp4All().filter(m => m.state !== 'done');
  const ativos = mp4Todos.filter(m => m.mode !== 'download');
  const mp4Baixando = mp4Todos.filter(m => m.mode === 'download');
  // Downloads rodando agora (aba Downloads mostra o progresso junto do histórico).
  const { meta: dlMeta, items: dlItems } = useDownloadList();
  const baixando = [...dlItems.values()]
    .filter(d => d.state === 'downloading' || d.state === 'queued' || d.state === 'restarting')
    .map(d => ({ key: d.key, percent: d.percent, state: d.state, name: nomeDe(dlMeta, d.key, d.title) }));
  useEffect(() => { markAllRead(); }, []);

  const shown = list.filter(n => n.kind === tab);
  const meta = TABS.find(t => t.key === tab)!;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-bold">Notificações</h1>
        </div>
        {list.length > 0 && (
          <Button variant="outline" size="sm" className="gap-1" onClick={clearNotices}>
            <Trash2 className="w-4 h-4" /> Limpar
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 border-b border-border">
        {TABS.map(t => {
          const n = list.filter(x => x.kind === t.key).length;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`pb-2 text-xs font-medium border-b-2 -mb-px transition ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
              {t.label}{n > 0 ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {/* Em andamento AGORA (só na aba Conversões): o % vai fechando aqui, sem
          precisar de um toast preso na tela. */}
      {tab === 'download' && (baixando.length > 0 || mp4Baixando.length > 0) && (
        <div className="space-y-2">
          {mp4Baixando.map(m => (
            <div key={m.key} className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-foreground truncate">
                  {m.state === 'queued' ? `${m.position ? `${m.position}º na fila` : 'Na fila'}` : 'Baixando em MP4'}
                  {m.name ? `: ${m.name.replace('.mp4', '')}` : ''}
                </p>
                <span className="text-xs text-primary shrink-0">{m.percent >= 0 ? `${m.percent}%` : '…'}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${m.percent >= 0 ? m.percent : 6}%` }} />
              </div>
            </div>
          ))}
          {baixando.map(d => (
            <div key={d.key} className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-foreground truncate">{d.state === 'downloading' ? 'Baixando' : 'Na fila'}: {d.name}</p>
                <span className="text-xs text-primary shrink-0">{d.percent >= 0 ? `${d.percent}%` : '…'}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${d.percent >= 0 ? d.percent : 6}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'mp4' && ativos.length > 0 && (
        <div className="space-y-2">
          {ativos.map(a => (
            <div key={a.key} className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-foreground truncate">
                  {a.state === 'queued' ? `${a.position ? `${a.position}º na fila` : 'Na fila'}` : 'Convertendo'}
                  {a.name ? `: ${a.name.replace('.mp4', '')}` : ''}
                </p>
                <span className="text-xs text-primary shrink-0">{a.percent >= 0 ? `${a.percent}%` : '…'}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${a.percent >= 0 ? a.percent : 6}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {shown.length === 0 && !(tab === 'mp4' && ativos.length > 0) && !(tab === 'download' && (baixando.length > 0 || mp4Baixando.length > 0)) ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{meta.empty}</p>
      ) : (
        <div className="space-y-2">
          {shown.map(n => (
            <div key={n.id} className="flex items-start gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5">
              <span className="mt-0.5 shrink-0"><Icon kind={n.kind} error={n.error} /></span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.error ? 'text-destructive' : 'text-foreground'}`}>{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{noticeWhen(n.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
