import { useState } from 'react';
import { WatchItem, Season } from '@/types/watch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatTime, formatDate, getSeasonProgress, getSeriesProgress } from '@/lib/formatters';
import {
  ArrowLeft, Plus, Minus, RotateCcw, Settings, Trash2, Save,
  ChevronDown, ChevronRight, MessageSquare
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { generateId } from '@/store/useWatchStore';

interface ItemDetailProps {
  item: WatchItem;
  onBack: () => void;
  onUpdate: (id: string, updates: Partial<WatchItem>) => void;
  onDelete: (id: string) => void;
  onIncrementEpisode: (itemId: string, seasonId: string) => void;
  onDecrementEpisode: (itemId: string, seasonId: string) => void;
  onResetSeason: (itemId: string, seasonId: string) => void;
  onResetItem: (itemId: string) => void;
}

export default function ItemDetail({
  item, onBack, onUpdate, onDelete,
  onIncrementEpisode, onDecrementEpisode,
  onResetSeason, onResetItem
}: ItemDetailProps) {
  const [expandedSeason, setExpandedSeason] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState(item.comment || '');

  // Edit state
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDuration, setEditDuration] = useState(String(item.totalDuration || ''));
  const [editSeasons, setEditSeasons] = useState<{ episodes: string; duration: string }[]>(
    item.seasons?.map(s => ({ episodes: String(s.totalEpisodes), duration: String(s.episodeDuration) })) || []
  );

  const isSeries = item.type === 'series';

  const saveEdit = () => {
    const updates: Partial<WatchItem> = { title: editTitle.trim() };
    if (isSeries) {
      const newSeasons: Season[] = editSeasons.map((se, i) => {
        const existing = item.seasons?.[i];
        return {
          id: existing?.id || generateId(),
          number: i + 1,
          totalEpisodes: parseInt(se.episodes) || 12,
          watchedEpisodes: existing?.watchedEpisodes || 0,
          episodeDuration: parseInt(se.duration) || 24,
          partialEpisodeTime: existing?.partialEpisodeTime,
        };
      });
      updates.seasons = newSeasons;
    } else {
      updates.totalDuration = parseInt(editDuration) || 120;
    }
    onUpdate(item.id, updates);
    setEditOpen(false);
  };

  const saveComment = () => {
    onUpdate(item.id, { comment });
    setCommentOpen(false);
  };

  const addSeasonToEdit = () => {
    setEditSeasons(prev => [...prev, { episodes: '12', duration: '24' }]);
  };

  // Stats
  const totalEps = item.seasons?.reduce((a, s) => a + s.totalEpisodes, 0) || 0;
  const watchedEps = item.seasons?.reduce((a, s) => a + s.watchedEpisodes, 0) || 0;
  const remainingEps = totalEps - watchedEps;
  const totalTime = item.seasons?.reduce((a, s) => a + s.totalEpisodes * s.episodeDuration, 0) || 0;
  const watchedTime = item.seasons?.reduce((a, s) => a + s.watchedEpisodes * s.episodeDuration + (s.partialEpisodeTime || 0), 0) || 0;
  const remainingTime = totalTime - watchedTime;
  const progress = isSeries ? getSeriesProgress(item.seasons || []) :
    (item.completed ? 100 : ((item.watchedDuration || 0) / (item.totalDuration || 1)) * 100);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-foreground truncate">{item.title}</h2>
          {item.lastWatchedAt && (
            <p className="text-xs text-muted-foreground">
              Assistido pela última vez em {formatDate(item.lastWatchedAt)}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCommentOpen(true)}>
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditOpen(true)}>
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onResetItem(item.id)}>
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => { onDelete(item.id); onBack(); }}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Comment */}
      {item.comment && (
        <div className="glass-card rounded-lg p-3 text-sm text-muted-foreground italic">
          💬 {item.comment}
        </div>
      )}

      {/* Overall progress */}
      <div className="glass-card rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-muted-foreground">Progresso geral</span>
          <span className="text-sm font-semibold">{Math.round(progress)}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        {isSeries && (
          <div className="grid grid-cols-3 gap-4 mt-4 text-center">
            <div>
              <p className="text-lg font-bold text-foreground">{watchedEps}</p>
              <p className="text-[11px] text-muted-foreground">Assistidos</p>
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{remainingEps}</p>
              <p className="text-[11px] text-muted-foreground">Restantes</p>
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{formatTime(remainingTime)}</p>
              <p className="text-[11px] text-muted-foreground">Tempo restante</p>
            </div>
          </div>
        )}
      </div>

      {/* Movie controls */}
      {!isSeries && (
        <div className="glass-card rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Duração: {formatTime(item.totalDuration || 0)}</span>
            <Button
              size="sm"
              variant={item.completed ? 'default' : 'outline'}
              onClick={() => onUpdate(item.id, {
                completed: !item.completed,
                watchedDuration: !item.completed ? item.totalDuration : item.watchedDuration,
                lastWatchedAt: new Date().toISOString()
              })}
            >
              {item.completed ? '✓ Completo' : 'Marcar completo'}
            </Button>
          </div>
          {!item.completed && (
            <div>
              <label className="text-xs text-muted-foreground">Tempo assistido (minutos)</label>
              <Input
                type="number"
                value={item.watchedDuration || 0}
                onChange={e => onUpdate(item.id, {
                  watchedDuration: parseInt(e.target.value) || 0,
                  lastWatchedAt: new Date().toISOString()
                })}
                className="mt-1 bg-muted border-border"
              />
            </div>
          )}
        </div>
      )}

      {/* Seasons */}
      {isSeries && item.seasons?.map(season => {
        const sp = getSeasonProgress(season);
        const isExpanded = expandedSeason === season.id;
        const seasonDone = season.watchedEpisodes >= season.totalEpisodes;
        const seasonRemaining = (season.totalEpisodes - season.watchedEpisodes) * season.episodeDuration;

        return (
          <div key={season.id} className="glass-card rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedSeason(isExpanded ? null : season.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-secondary/30 transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Temporada {season.number}</span>
                  {seasonDone && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">✓</span>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {season.watchedEpisodes}/{season.totalEpisodes} eps · {formatTime(season.episodeDuration)}/ep · Faltam {formatTime(seasonRemaining)}
                </span>
              </div>
              <span className="text-xs font-medium text-muted-foreground">{Math.round(sp)}%</span>
            </button>

            {/* Mini progress */}
            <div className="px-4 pb-1">
              <div className="progress-bar h-1">
                <div className="progress-fill" style={{ width: `${Math.min(sp, 100)}%` }} />
              </div>
            </div>

            {isExpanded && (
              <div className="p-4 pt-3 border-t border-border/50 animate-fade-in">
                <div className="flex items-center justify-center gap-4">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 rounded-full"
                    onClick={() => onDecrementEpisode(item.id, season.id)}
                    disabled={season.watchedEpisodes <= 0}
                  >
                    <Minus className="w-5 h-5" />
                  </Button>
                  <div className="text-center">
                    <p className="text-3xl font-bold text-foreground">{season.watchedEpisodes}</p>
                    <p className="text-xs text-muted-foreground">de {season.totalEpisodes} episódios</p>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 rounded-full"
                    onClick={() => onIncrementEpisode(item.id, season.id)}
                    disabled={season.watchedEpisodes >= season.totalEpisodes}
                  >
                    <Plus className="w-5 h-5" />
                  </Button>
                </div>
                <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                  <span>Faltam {season.totalEpisodes - season.watchedEpisodes} episódios</span>
                  <span>{formatTime(seasonRemaining)} restantes</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-xs text-muted-foreground"
                  onClick={() => onResetSeason(item.id, season.id)}
                >
                  <RotateCcw className="w-3 h-3 mr-1" /> Zerar temporada
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar {isSeries ? 'Série' : 'Filme'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Título</label>
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="mt-1 bg-muted border-border" />
            </div>
            {isSeries ? (
              <>
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {editSeasons.map((se, i) => (
                    <div key={i} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                      <span className="text-xs text-muted-foreground font-medium w-8">T{i + 1}</span>
                      <div className="flex-1">
                        <Input
                          type="number" value={se.episodes}
                          onChange={e => {
                            const arr = [...editSeasons];
                            arr[i] = { ...arr[i], episodes: e.target.value };
                            setEditSeasons(arr);
                          }}
                          className="h-8 text-sm bg-muted border-border"
                        />
                        <span className="text-[10px] text-muted-foreground">episódios</span>
                      </div>
                      <div className="flex-1">
                        <Input
                          type="number" value={se.duration}
                          onChange={e => {
                            const arr = [...editSeasons];
                            arr[i] = { ...arr[i], duration: e.target.value };
                            setEditSeasons(arr);
                          }}
                          className="h-8 text-sm bg-muted border-border"
                        />
                        <span className="text-[10px] text-muted-foreground">min/ep</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={addSeasonToEdit} className="w-full">
                  <Plus className="w-3 h-3 mr-1" /> Adicionar temporada
                </Button>
              </>
            ) : (
              <div>
                <label className="text-sm text-muted-foreground">Duração (minutos)</label>
                <Input type="number" value={editDuration} onChange={e => setEditDuration(e.target.value)} className="mt-1 bg-muted border-border" />
              </div>
            )}
            <Button onClick={saveEdit} className="w-full">
              <Save className="w-4 h-4 mr-1" /> Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Comment Dialog */}
      <Dialog open={commentOpen} onOpenChange={setCommentOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Comentário</DialogTitle>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Adicione um comentário..."
            className="bg-muted border-border min-h-[100px]"
          />
          <Button onClick={saveComment} className="w-full">
            <Save className="w-4 h-4 mr-1" /> Salvar comentário
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
