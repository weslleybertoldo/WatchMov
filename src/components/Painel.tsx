import { useMemo } from 'react';
import { WatchItem, DashboardStats } from '@/types/watch';
import { formatTime, formatDate } from '@/lib/formatters';
import { Film, Tv, Clock, CheckCircle, Play, Star, type LucideIcon } from 'lucide-react';

interface PainelProps {
  stats: DashboardStats;
  items: WatchItem[];
  onSelectItem: (id: string) => void;
}

const StatCard = ({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string | number; sub?: string }) => (
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

export function isWatched(item: WatchItem): boolean {
  if (item.type === 'movie') return !!item.completed;
  if (!item.seasons || item.seasons.length === 0) return false;
  return item.seasons.every(s => s.watchedEpisodes >= s.totalEpisodes);
}

export default function Painel({ stats, items, onSelectItem }: PainelProps) {
  const watched = useMemo(() => {
    return items
      .filter(isWatched)
      .sort((a, b) => {
        const ta = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0;
        const tb = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0;
        return tb - ta;
      });
  }, [items]);

  const horas = Math.round(stats.totalTimeWatched / 60);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-gradient">Painel</h1>
        <p className="text-muted-foreground mt-1">Resumo do que você já assistiu</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Film} label="Filmes" value={stats.totalMovies} />
        <StatCard icon={Tv} label="Séries" value={stats.totalSeries} />
        <StatCard icon={Play} label="Episódios assistidos" value={stats.totalEpisodesWatched} />
        <StatCard icon={CheckCircle} label="Concluídos" value={stats.completedItems} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          icon={Clock}
          label="Horas assistidas"
          value={`${horas}h`}
          sub={formatTime(stats.totalTimeWatched)}
        />
        <StatCard
          icon={Star}
          label="Favoritos"
          value={items.filter(i => i.favorite).length}
        />
      </div>

      {/* Já assistidos */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Já assistidos ({watched.length})</h2>
        {watched.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nada concluído ainda. Marque um filme como completo ou termine uma série.
          </div>
        ) : (
          <div className="grid gap-2">
            {watched.map(item => (
              <button
                key={item.id}
                onClick={() => onSelectItem(item.id)}
                className="glass-card rounded-lg p-3 flex items-center gap-3 text-left hover:bg-secondary/50 transition-all"
              >
                {item.posterUrl ? (
                  <img src={item.posterUrl} alt="" className="w-10 h-15 rounded object-cover bg-muted shrink-0" />
                ) : (
                  <div className="w-10 h-15 rounded bg-muted shrink-0 flex items-center justify-center text-lg">
                    {item.type === 'series' ? '📺' : '🎬'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate flex items-center gap-1.5">
                    {item.favorite && <Star className="w-3.5 h-3.5 fill-primary text-primary shrink-0" />}
                    <span className="truncate">{item.title}</span>
                  </p>
                  {item.lastWatchedAt && (
                    <p className="text-[11px] text-muted-foreground">
                      Assistido última vez {formatDate(item.lastWatchedAt)}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
