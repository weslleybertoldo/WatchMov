import { MediaSummary } from '@/lib/tmdb';
import { formatRating } from '@/lib/formatters';
import { Star, Film, Tv } from 'lucide-react';

interface MediaCardProps {
  media: MediaSummary;
  onClick: () => void;
  rank?: number; // numeração Top 10
}

export default function MediaCard({ media, onClick, rank }: MediaCardProps) {
  const rating = formatRating(media.rating, media.votes);
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
      <div className="rounded-lg overflow-hidden bg-muted aspect-[2/3] ring-1 ring-border group-hover:ring-primary transition-all">
        {media.posterUrl ? (
          <img src={media.posterUrl} alt={media.title} loading="lazy" className="w-full h-full object-cover" />
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
