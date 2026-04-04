import { useState } from 'react';
import { WatchItem, Season } from '@/types/watch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Minus } from 'lucide-react';
import { generateId } from '@/store/useWatchStore';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  onAdd: (item: Omit<WatchItem, 'id' | 'createdAt'>) => void;
}

export default function AddItemDialog({ open, onOpenChange, sectionId, onAdd }: AddItemDialogProps) {
  const [type, setType] = useState<'movie' | 'series'>('series');
  const [title, setTitle] = useState('');
  // Movie
  const [movieDuration, setMovieDuration] = useState('');
  // Series
  const [seasonCount, setSeasonCount] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<{ episodes: string; duration: string }[]>([
    { episodes: '12', duration: '24' },
  ]);

  const updateSeasonCount = (count: number) => {
    if (count < 1) return;
    setSeasonCount(count);
    setSeasonEpisodes(prev => {
      const arr = [...prev];
      while (arr.length < count) arr.push({ episodes: '12', duration: '24' });
      return arr.slice(0, count);
    });
  };

  const updateSeasonField = (idx: number, field: 'episodes' | 'duration', value: string) => {
    setSeasonEpisodes(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSubmit = () => {
    if (!title.trim()) return;

    if (type === 'movie') {
      onAdd({
        sectionId,
        title: title.trim(),
        type: 'movie',
        totalDuration: parseInt(movieDuration) || 120,
        watchedDuration: 0,
        completed: false,
      });
    } else {
      const seasons: Season[] = seasonEpisodes.map((se, i) => ({
        id: generateId(),
        number: i + 1,
        totalEpisodes: parseInt(se.episodes) || 12,
        watchedEpisodes: 0,
        episodeDuration: parseInt(se.duration) || 24,
      }));
      onAdd({
        sectionId,
        title: title.trim(),
        type: 'series',
        seasons,
      });
    }

    // Reset
    setTitle('');
    setMovieDuration('');
    setSeasonCount(1);
    setSeasonEpisodes([{ episodes: '12', duration: '24' }]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar novo item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Type selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setType('series')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                type === 'series' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              📺 Série / Anime
            </button>
            <button
              onClick={() => setType('movie')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                type === 'movie' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              🎬 Filme
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="text-sm text-muted-foreground">Título</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Nome do filme ou série"
              className="mt-1 bg-muted border-border"
            />
          </div>

          {type === 'movie' ? (
            <div>
              <label className="text-sm text-muted-foreground">Duração total (minutos)</label>
              <Input
                type="number"
                value={movieDuration}
                onChange={e => setMovieDuration(e.target.value)}
                placeholder="120"
                className="mt-1 bg-muted border-border"
              />
            </div>
          ) : (
            <>
              {/* Season count */}
              <div>
                <label className="text-sm text-muted-foreground">Número de temporadas</label>
                <div className="flex items-center gap-3 mt-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={() => updateSeasonCount(seasonCount - 1)}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span className="text-lg font-bold w-8 text-center">{seasonCount}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={() => updateSeasonCount(seasonCount + 1)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Season details */}
              <div className="space-y-3 max-h-48 overflow-y-auto">
                {seasonEpisodes.map((se, i) => (
                  <div key={i} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                    <span className="text-xs text-muted-foreground font-medium w-8">T{i + 1}</span>
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={se.episodes}
                        onChange={e => updateSeasonField(i, 'episodes', e.target.value)}
                        placeholder="Eps"
                        className="h-8 text-sm bg-muted border-border"
                      />
                      <span className="text-[10px] text-muted-foreground">episódios</span>
                    </div>
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={se.duration}
                        onChange={e => updateSeasonField(i, 'duration', e.target.value)}
                        placeholder="Min"
                        className="h-8 text-sm bg-muted border-border"
                      />
                      <span className="text-[10px] text-muted-foreground">min/ep</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <Button onClick={handleSubmit} className="w-full">
            Adicionar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
