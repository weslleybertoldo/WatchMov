import { WatchItem } from '@/types/watch';
import { formatTime, formatDate, getSeriesProgress } from '@/lib/formatters';
import { Clock, Calendar, MessageSquare } from 'lucide-react';

interface ItemCardProps {
  item: WatchItem;
  onClick: () => void;
}

export default function ItemCard({ item, onClick }: ItemCardProps) {
  const isSeries = item.type === 'series';

  let progress = 0;
  let statusText = '';

  if (isSeries && item.seasons) {
    progress = getSeriesProgress(item.seasons);
    const totalEps = item.seasons.reduce((a, s) => a + s.totalEpisodes, 0);
    const watchedEps = item.seasons.reduce((a, s) => a + s.watchedEpisodes, 0);
    statusText = `${watchedEps}/${totalEps} episódios`;
  } else if (item.type === 'movie') {
    const total = item.totalDuration || 0;
    const watched = item.watchedDuration || 0;
    progress = total > 0 ? (watched / total) * 100 : 0;
    if (item.completed) progress = 100;
    statusText = item.completed ? 'Completo' : `${formatTime(watched)} / ${formatTime(total)}`;
  }

  const isComplete = progress >= 100;

  return (
    <div
      onClick={onClick}
      className="glass-card rounded-lg p-4 cursor-pointer hover:bg-secondary/50 transition-all animate-slide-up group"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {item.title}
          </h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {isSeries ? '📺' : '🎬'} {statusText}
            </span>
            {item.seasons && (
              <span>{item.seasons.length} temporada{item.seasons.length > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">
            ✓ Concluído
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="progress-bar mt-3">
        <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-muted-foreground">{Math.round(progress)}%</span>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {item.comment && <MessageSquare className="w-3 h-3" />}
          {item.lastWatchedAt && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(item.lastWatchedAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
