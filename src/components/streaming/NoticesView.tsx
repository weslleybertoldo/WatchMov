import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trash2, DownloadCloud, Tv, AlertCircle, Sparkles } from 'lucide-react';
import { useNotices, markAllRead, clearNotices, noticeWhen, type NoticeKind } from '@/lib/appNotices';

const TABS: { key: NoticeKind; label: string; empty: string }[] = [
  { key: 'release', label: 'Lançamentos', empty: 'Nada lançado ainda. Ligue o sino num título pra ser avisado quando estrear ou sair episódio novo.' },
  { key: 'download', label: 'Downloads', empty: 'Nenhum download concluído por aqui ainda.' },
  { key: 'mp4', label: 'Conversões', empty: 'Nenhuma conversão pra MP4 ainda.' },
];

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

      {shown.length === 0 ? (
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
