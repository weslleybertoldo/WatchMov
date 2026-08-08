import { Film, Tv, Sparkles, History, Download, Bug, LogOut, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface WatchedStats {
  moviesCount: number;
  seriesCount: number;
  seriesEpisodes: number;
  animesCount: number;
  animeEpisodes: number;
}

interface StatCardProps {
  icon: typeof Film;
  label: string;
  count: number;
  episodes?: number;
}

function StatCard({ icon: Icon, label, count, episodes }: StatCardProps) {
  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col items-center text-center gap-1">
      <Icon className="w-6 h-6 text-primary" />
      <span className="text-2xl font-bold text-foreground">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      {episodes !== undefined && (
        <span className="text-[11px] text-primary/80">{episodes} episódio{episodes === 1 ? '' : 's'}</span>
      )}
    </div>
  );
}

interface SettingsViewProps {
  stats: WatchedStats;
  onHistory: () => void;
  onDownload: () => void;
  onBugs: () => void;
  onSignOut: () => void;
  onBack: () => void;
}

export default function SettingsView({ stats, onHistory, onDownload, onBugs, onSignOut, onBack }: SettingsViewProps) {
  return (
    <div className="space-y-6 animate-fade-in max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold">Painel</h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={Film} label="Filmes assistidos" count={stats.moviesCount} />
        <StatCard icon={Tv} label="Séries assistidas" count={stats.seriesCount} episodes={stats.seriesEpisodes} />
        <StatCard icon={Sparkles} label="Animes assistidos" count={stats.animesCount} episodes={stats.animeEpisodes} />
      </div>

      <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onHistory}>
        <History className="w-4 h-4" /> Histórico
      </Button>

      <Button variant="secondary" className="w-full justify-between gap-2 h-11" onClick={onDownload}>
        <span className="flex items-center gap-2"><Download className="w-4 h-4" /> Download</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">em breve</span>
      </Button>

      <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onBugs}>
        <Bug className="w-4 h-4" /> Bugs
      </Button>

      <Button variant="ghost" className="w-full justify-start gap-2 h-11 text-muted-foreground" onClick={onSignOut}>
        <LogOut className="w-4 h-4" /> Sair
      </Button>
    </div>
  );
}
