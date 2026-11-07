import { Film, Tv, Sparkles, History, Download, Bug, LogOut, ArrowLeft, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isTv } from '@/lib/device';
import IconeControle from '@/components/streaming/IconeControle';

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
  onServers: () => void;
  onBugs: () => void;
  onTv: () => void;
  onRemote: () => void;
  onSignOut: () => void;
  onBack: () => void;
}

export default function SettingsView({ stats, onHistory, onDownload, onServers, onBugs, onTv, onRemote, onSignOut, onBack }: SettingsViewProps) {
  return (
    <div className="space-y-6 max-w-xl mx-auto">
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

      <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onDownload}>
        <Download className="w-4 h-4" /> Download
      </Button>

      {/* Servidores (abaixo de Download — pedido 07/09/2026): marcar a fonte favorita do Assistir. */}
      <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onServers}>
        <Server className="w-4 h-4" /> Servidores
      </Button>

      {/* Login da TV (Fire TV): TVs conectadas + Conectar (código que a TV mostra). Na própria TV não aparece. */}
      {!isTv() && (
        <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onTv}>
          <Tv className="w-4 h-4" /> Entrar na TV
        </Button>
      )}

      {/* Controle remoto (pedido dele 07/11/2026): escolhe uma das TVs conectadas e comanda o WatchMov dela. */}
      {!isTv() && (
        <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onRemote}>
          <IconeControle className="w-4 h-4" /> Controle remoto
        </Button>
      )}

      <Button variant="secondary" className="w-full justify-start gap-2 h-11" onClick={onBugs}>
        <Bug className="w-4 h-4" /> Bugs
      </Button>

      <Button variant="ghost" className="w-full justify-start gap-2 h-11 text-muted-foreground" onClick={onSignOut}>
        <LogOut className="w-4 h-4" /> Sair
      </Button>
    </div>
  );
}
