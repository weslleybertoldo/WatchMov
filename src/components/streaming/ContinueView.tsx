import { useState } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pencil, Check, X } from 'lucide-react';

export interface ContinueEntry { id: string; summary: MediaSummary }

interface Props {
  entries: ContinueEntry[];
  onOpen: (m: MediaSummary) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
}

export default function ContinueView({ entries, onOpen, onRemove, onBack }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">Continuar assistindo</h1>
        </div>
        <Button variant={editing ? 'default' : 'outline'} size="icon" className="h-8 w-8"
          title={editing ? 'Concluir' : 'Remover itens'} onClick={() => setEditing(e => !e)}>
          {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nada em andamento.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {entries.map(({ id, summary }) => (
            <div key={`${summary.type}-${summary.tmdbId}`} className="relative">
              <MediaCard media={summary} onClick={() => editing ? onRemove(id) : onOpen(summary)} />
              {editing && (
                <button
                  onClick={() => onRemove(id)}
                  className="absolute -top-1 -right-1 z-10 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
                  title="Remover da lista de assistidos"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
