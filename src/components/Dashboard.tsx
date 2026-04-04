import { formatTime } from '@/lib/formatters';
import { DashboardStats } from '@/types/watch';
import { Film, Tv, Clock, CheckCircle, Play, BarChart3, Timer } from 'lucide-react';

interface DashboardProps {
  stats: DashboardStats;
}

const StatCard = ({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) => (
  <div className="glass-card rounded-lg p-5 animate-slide-up">
    <div className="flex items-center gap-3 mb-2">
      <div className="p-2 rounded-md bg-primary/15">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
  </div>
);

export default function Dashboard({ stats }: DashboardProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold">
          <span className="text-gradient">WatchTracker</span>
        </h1>
        <p className="text-muted-foreground mt-1">Seu painel de controle de filmes e séries</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={BarChart3} label="Total registrados" value={stats.totalItems} />
        <StatCard icon={Tv} label="Séries" value={stats.totalSeries} />
        <StatCard icon={Film} label="Filmes" value={stats.totalMovies} />
        <StatCard icon={CheckCircle} label="Concluídos" value={stats.completedItems} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={Play}
          label="Episódios assistidos"
          value={stats.totalEpisodesWatched}
        />
        <StatCard
          icon={Clock}
          label="Tempo assistido"
          value={formatTime(stats.totalTimeWatched)}
          sub={`${Math.round(stats.totalTimeWatched / 60)} horas no total`}
        />
        <StatCard
          icon={Timer}
          label="Tempo restante"
          value={formatTime(stats.totalTimeRemaining)}
          sub={`${Math.round(stats.totalTimeRemaining / 60)} horas restantes`}
        />
      </div>
    </div>
  );
}
