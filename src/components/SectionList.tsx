import { useState } from 'react';
import { Section } from '@/types/watch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface SectionListProps {
  sections: Section[];
  activeSection: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string, icon?: string) => void;
  onUpdate: (id: string, updates: Partial<Section>) => void;
  onDelete: (id: string) => void;
}

const ICONS = ['📁', '🎬', '📺', '⛩️', '🎭', '🎮', '📚', '🎵', '🌍', '⭐', '🔥', '💎'];

export default function SectionList({ sections, activeSection, onSelect, onAdd, onUpdate, onDelete }: SectionListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('📁');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAdd(newName.trim(), newIcon);
    setNewName('');
    setNewIcon('📁');
    setDialogOpen(false);
  };

  const startEdit = (s: Section) => {
    setEditId(s.id);
    setEditName(s.name);
  };

  const confirmEdit = (id: string) => {
    if (editName.trim()) onUpdate(id, { name: editName.trim() });
    setEditId(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Seções</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7">
              <Plus className="w-4 h-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>Nova Seção</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Nome da seção"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="bg-muted border-border"
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <div>
                <p className="text-sm text-muted-foreground mb-2">Ícone</p>
                <div className="flex flex-wrap gap-2">
                  {ICONS.map(ic => (
                    <button
                      key={ic}
                      onClick={() => setNewIcon(ic)}
                      className={`w-9 h-9 rounded-md flex items-center justify-center text-lg transition-all ${
                        newIcon === ic ? 'bg-primary/20 ring-2 ring-primary' : 'bg-muted hover:bg-secondary'
                      }`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={handleAdd} className="w-full">Criar Seção</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sections.map(s => (
        <div
          key={s.id}
          className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
            activeSection === s.id
              ? 'bg-primary/15 text-foreground glow-border'
              : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onSelect(s.id)}
        >
          <span className="text-lg">{s.icon}</span>
          {editId === s.id ? (
            <div className="flex-1 flex items-center gap-1">
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="h-7 text-sm bg-muted border-border"
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmEdit(s.id);
                  if (e.key === 'Escape') setEditId(null);
                }}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); confirmEdit(s.id); }}>
                <Check className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); setEditId(null); }}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <>
              <span className="flex-1 text-sm font-medium">{s.name}</span>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); startEdit(s); }}
                  className="p-1 rounded hover:bg-muted"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
