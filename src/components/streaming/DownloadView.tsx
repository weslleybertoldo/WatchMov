import { useState } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import MediaCard from './MediaCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pencil, Check, X, Trash2 } from 'lucide-react';

export interface DownloadedEp { season: number; ep: number }

interface DownloadViewProps {
  movies: MediaSummary[];
  series: MediaSummary[];
  animes: MediaSummary[];
  onOpen: (media: MediaSummary) => void;              // filme → abre detalhe
  onRemove: (media: MediaSummary) => void;            // lápis → exclui todos os downloads do título
  episodesOf: (tmdbId: number) => DownloadedEp[];      // eps baixados de uma série
  onRemoveEpisodes: (tmdbId: number, eps: DownloadedEp[]) => void;
  onBack: () => void;
}

function Section({ title, items, editing, onOpen, onRemove }: {
  title: string; items: MediaSummary[]; editing: boolean;
  onOpen: (m: MediaSummary) => void; onRemove: (m: MediaSummary) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {items.map(m => (
          <div key={`${m.type}-${m.tmdbId}`} className="relative">
            <MediaCard media={m} onClick={() => (editing ? onRemove(m) : onOpen(m))} />
            {editing && (
              <button
                onClick={() => onRemove(m)}
                className="absolute -top-1 -right-1 z-10 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
                title="Excluir todos os downloads"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Sub-tela: eps baixados de uma série, com seleção pra excluir individualmente.
function SeriesDownloads({ media, episodes, onRemoveEpisodes, onBack }: {
  media: MediaSummary; episodes: DownloadedEp[];
  onRemoveEpisodes: (tmdbId: number, eps: DownloadedEp[]) => void; onBack: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const key = (e: DownloadedEp) => `${e.season}:${e.ep}`;
  const toggle = (e: DownloadedEp) => setSel(prev => {
    const next = new Set(prev);
    if (next.has(key(e))) next.delete(key(e)); else next.add(key(e));
    return next;
  });
  const removeSelected = () => {
    const eps = episodes.filter(e => sel.has(key(e)));
    if (eps.length) onRemoveEpisodes(media.tmdbId, eps);
    setSel(new Set());
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold truncate">{media.title}</h1>
      </div>
      <p className="text-sm text-muted-foreground">Episódios baixados — selecione pra excluir.</p>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {episodes.map(e => {
          const picked = sel.has(key(e));
          return (
            <button key={key(e)} onClick={() => toggle(e)}
              className={`relative aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-medium border transition ${picked ? 'border-destructive bg-destructive/15 text-destructive' : 'border-green-400/40 bg-green-400/5 text-foreground'}`}>
              <span className="text-[10px] text-muted-foreground">T{e.season}</span>
              <span className="text-sm">{e.ep}</span>
              {picked && (
                <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-sm bg-destructive flex items-center justify-center">
                  <Check className="w-3 h-3 text-destructive-foreground" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Button variant="destructive" className="w-full gap-2" onClick={removeSelected} disabled={sel.size === 0}>
        <Trash2 className="w-4 h-4" /> Excluir{sel.size > 0 ? ` (${sel.size})` : ''}
      </Button>
    </div>
  );
}

// Mesma separação da Minha Lista (Filmes/Séries/Animes). Lápis exclui todos os
// downloads do título; clicar numa série abre os eps baixados pra excluir individual.
export default function DownloadView({ movies, series, animes, onOpen, onRemove, episodesOf, onRemoveEpisodes, onBack }: DownloadViewProps) {
  const [editing, setEditing] = useState(false);
  const [openSeries, setOpenSeries] = useState<MediaSummary | null>(null);
  const empty = movies.length === 0 && series.length === 0 && animes.length === 0;

  if (openSeries) {
    const eps = episodesOf(openSeries.tmdbId);
    if (eps.length === 0) { setOpenSeries(null); return null; }
    return <SeriesDownloads media={openSeries} episodes={eps} onRemoveEpisodes={onRemoveEpisodes} onBack={() => setOpenSeries(null)} />;
  }

  // Série/anime abre a sub-tela de eps; filme abre o detalhe.
  const openItem = (m: MediaSummary) => (m.type === 'tv' ? setOpenSeries(m) : onOpen(m));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-bold">Download</h1>
        </div>
        {!empty && (
          <Button variant={editing ? 'default' : 'outline'} size="icon" className="h-8 w-8"
            title={editing ? 'Concluir' : 'Excluir downloads'} onClick={() => setEditing(e => !e)}>
            {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </Button>
        )}
      </div>

      {empty ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Em desenvolvimento — seus filmes, séries e animes baixados vão aparecer aqui, separados por tipo.
        </p>
      ) : (
        <>
          <Section title="Filmes" items={movies} editing={editing} onOpen={openItem} onRemove={onRemove} />
          <Section title="Séries" items={series} editing={editing} onOpen={openItem} onRemove={onRemove} />
          <Section title="Animes" items={animes} editing={editing} onOpen={openItem} onRemove={onRemove} />
        </>
      )}
    </div>
  );
}
