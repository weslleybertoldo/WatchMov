import { useState } from 'react';
import { MediaSummary } from '@/lib/tmdb';
import { formatRating } from '@/lib/formatters';
import { Star, Film, Tv } from 'lucide-react';

interface MediaCardProps {
  media: MediaSummary;
  onClick: () => void;
  rank?: number; // numeração Top 10
}

// Ainda não lançou (data futura) → tag "Em breve": avisa que não dá pra assistir.
export function isUpcoming(date?: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date > new Date().toISOString().slice(0, 10);
}

// Lançou faz menos de 30 dias → tag "Novo". Passado o mês, some sozinha (a conta é
// feita na hora, não fica nada gravado).
export const NEW_DAYS = 30;
export function isNew(date?: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const hoje = new Date().toISOString().slice(0, 10);
  if (date > hoje) return false;                       // ainda não lançou = "Em breve"
  const limite = new Date(Date.now() - NEW_DAYS * 86400000).toISOString().slice(0, 10);
  return date >= limite;
}

export default function MediaCard({ media, onClick, rank }: MediaCardProps) {
  const rating = formatRating(media.rating, media.votes);
  const [loaded, setLoaded] = useState(false);
  const upcoming = isUpcoming(media.date);
  const fresh = isNew(media.date);
  return (
    <button
      onClick={onClick}
      className="relative shrink-0 w-28 sm:w-32 text-left group"
    >
      {rank !== undefined && (
        <span className="absolute -left-1 top-0 z-10 text-4xl font-black text-primary/80 drop-shadow [-webkit-text-stroke:1px_hsl(var(--background))]">
          {rank}
        </span>
      )}
      {upcoming ? (
        <span className="absolute top-1 left-1 z-10 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/70 text-white/90 backdrop-blur-sm">
          Em breve
        </span>
      ) : fresh ? (
        <span className="absolute top-1 left-1 z-10 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
          Novo
        </span>
      ) : null}
      <div className={`rounded-lg overflow-hidden bg-muted aspect-[2/3] ring-1 ring-border group-hover:ring-primary transition-all ${media.posterUrl && !loaded ? 'animate-pulse' : ''}`}>
        {media.posterUrl ? (
          <img
            src={media.posterUrl}
            alt={media.title}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {media.type === 'tv' ? <Tv className="w-6 h-6" /> : <Film className="w-6 h-6" />}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs font-medium text-foreground truncate">{media.title}</p>
      {media.subtitle && (
        <p className="text-[10px] text-green-400 truncate">{media.subtitle}</p>
      )}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {media.year && <span>{media.year}</span>}
        {rating && (
          <span className="flex items-center gap-0.5">
            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" /> {rating}
          </span>
        )}
      </div>
      {media.progress && (
        <div className="mt-1">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${Math.round(media.progress.pct * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{media.progress.label}</p>
        </div>
      )}
    </button>
  );
}
