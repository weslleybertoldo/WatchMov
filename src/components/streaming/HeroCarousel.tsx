import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { trendingToday, type MediaSummary } from '@/lib/tmdb';

// Hero "Populares Hoje" (estilo Smart Play): backdrop grande em carrossel
// auto-rotativo, com play + dots. Toque abre o título.
export default function HeroCarousel({ onOpen }: { onOpen: (m: MediaSummary) => void }) {
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [i, setI] = useState(0);
  const startX = useRef<number | null>(null);
  const swiped = useRef(false);                 // distingue arraste de toque (não abre no swipe)
  const go = (dir: number) => setI(p => (p + dir + items.length) % items.length);

  useEffect(() => {
    let alive = true;
    trendingToday().then(r => { if (alive) setItems(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI(p => (p + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);

  if (!items.length) return null;
  const idx = i % items.length;
  const m = items[idx];
  const bg = m.backdropUrl || m.posterUrl;

  return (
    <div
      className="relative -mx-4 -mt-2 mb-2 aspect-video max-h-[46vh] overflow-hidden cursor-pointer animate-fade-in"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={(e) => { startX.current = e.touches[0].clientX; swiped.current = false; }}
      onTouchMove={(e) => { if (startX.current != null && Math.abs(e.touches[0].clientX - startX.current) > 10) swiped.current = true; }}
      onTouchEnd={(e) => {
        if (startX.current == null || items.length < 2) { startX.current = null; return; }
        const dx = e.changedTouches[0].clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 40) { swiped.current = true; go(dx < 0 ? 1 : -1); }
      }}
      onClick={() => { if (swiped.current) { swiped.current = false; return; } onOpen(m); }}>
      {bg && <img key={bg} src={bg} alt={m.title} className="w-full h-full object-cover animate-fade-in" />}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 p-4 flex flex-col items-center text-center gap-1.5">
        <div className="rounded-full bg-primary/90 w-14 h-14 flex items-center justify-center shadow-lg mb-1">
          <Play className="w-7 h-7 text-primary-foreground fill-current" />
        </div>
        <p className="text-[11px] tracking-[0.2em] text-white/70 font-semibold">POPULAR HOJE</p>
        <h2 className="text-lg font-bold text-white drop-shadow line-clamp-1 px-4">{m.title}</h2>
        <div className="flex gap-1.5 mt-1">
          {items.map((_, k) => (
            <button
              key={k}
              onClick={(e) => { e.stopPropagation(); setI(k); }}
              className={`h-1.5 rounded-full transition-all ${k === idx ? 'w-5 bg-primary' : 'w-1.5 bg-white/40'}`}
              aria-label={`slide ${k + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
