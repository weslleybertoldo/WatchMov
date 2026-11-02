import { memo, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { trendingToday, type MediaSummary } from '@/lib/tmdb';
import { isTv } from '@/lib/device';
import { usePaginaVisivel } from '@/hooks/use-pagina-visivel';
import { guardarFileira, lerFileira } from '@/lib/fileirasGuardadas';
import { depoisDeAssentar } from '@/lib/ocioso';
import { useTelaVisivel } from '@/lib/telas';

// Cache em memória: ao voltar do detalhe o hero remonta JÁ com os itens (mesma altura
// na hora). Antes nascia vazio (altura 0) e, quando a TMDB respondia, empurrava a
// página inteira pra baixo — a posição do scroll restaurada ficava errada ("a tela
// vai descendo"). Mesmo padrão do rowCache do MediaRow.
let heroCache: MediaSummary[] | null = null;
// W1 do raio-x (02/11/2026): na 1ª montagem da sessão vem do guardado no aparelho (fileirasGuardadas) — aparece na hora.
// Velho (> 6 h): a TMDB é consultada no ocioso e a resposta fica pra próxima abertura (o destaque não troca na cara).
let heroVelho = false;
function heroDoAparelho(): MediaSummary[] | null {
  if (heroCache) return heroCache;
  const g = lerFileira('hero');
  if (!g) return null;
  heroCache = g.itens;
  heroVelho = !g.fresca;
  return heroCache;
}

// Hero "Populares Hoje" (estilo Smart Play): backdrop grande em carrossel
// auto-rotativo, com play + dots. Toque abre o título.
function HeroCarousel({ onOpen }: { onOpen: (m: MediaSummary) => void }) {
  const [items, setItems] = useState<MediaSummary[]>(() => heroDoAparelho() ?? []);
  const [i, setI] = useState(0);
  const startX = useRef<number | null>(null);
  const swiped = useRef(false);                 // distingue arraste de toque (não abre no swipe)
  const go = (dir: number) => setI(p => (p + dir + items.length) % items.length);

  useEffect(() => {
    if (heroCache) {
      if (heroVelho) {
        heroVelho = false;
        depoisDeAssentar(() => { trendingToday().then(r => guardarFileira('hero', r)).catch(() => undefined); }, 4000);
      }
      return;
    }
    let alive = true;
    trendingToday().then(r => { heroCache = r; guardarFileira('hero', r); if (alive) setItems(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Com o player por cima (página escondida) o carrossel para: ninguém vê e cada troca redesenha o fundo grande.
  // W4 das quedas na Fire TV (01/11/2026): na TV ele não gira sozinho — cada troca decodifica e redesenha a imagem
  // grande enquanto a pessoa navega pelas fileiras. As setas ← → no destaque continuam trocando.
  // W3 do raio-x (02/11/2026): o Início fica montado e escondido com um título por cima — o carrossel para também aí.
  const visivel = usePaginaVisivel();
  const telaVisivel = useTelaVisivel();
  useEffect(() => {
    if (items.length < 2 || !visivel || !telaVisivel || isTv()) return;
    const t = setInterval(() => setI(p => (p + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length, visivel, telaVisivel]);

  if (!items.length) return null;
  const idx = i % items.length;
  const m = items[idx];
  const bg = m.backdropUrl || m.posterUrl;
  const tv = isTv();

  return (
    <div
      // aspect-video + max-h: quando a ALTURA trava (desktop), o aspect-ratio
      // encolhe a LARGURA e o hero fica num canto com faixa preta ao lado.
      // Em md+ solta o ratio e fixa a altura: largura total, imagem cobre.
      className="relative -mx-4 md:-mx-6 -mt-2 mb-2 aspect-video max-h-[46vh] md:aspect-auto md:h-[46vh] md:max-h-none overflow-hidden cursor-pointer animate-fade-in"
      data-row-key="hero"
      {...(tv ? {
        tabIndex: 0, role: 'button', 'aria-label': m.title,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          go(e.key === 'ArrowRight' ? 1 : -1);
        },
      } : {})}
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
      {/* A imagem do destaque é a maior da tela: baixa antes das capas (fetchpriority) e decodifica fora do desenho. */}
      {bg && <img key={bg} src={bg} alt={m.title} decoding="async" {...{ fetchpriority: 'high' }} className="w-full h-full object-cover animate-fade-in" />}
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
              tabIndex={tv ? -1 : undefined}
              className={`h-1.5 rounded-full transition-all ${k === idx ? 'w-5 bg-primary' : 'w-1.5 bg-white/40'}`}
              aria-label={`slide ${k + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// W2 do raio-x (02/11/2026): o destaque não redesenha quando o Index redesenha (o onOpen dele é estável).
export default memo(HeroCarousel);
