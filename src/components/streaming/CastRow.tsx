import { useEffect, useState } from 'react';
import { getCredits, type TmdbCastMember, type TmdbMediaType } from '@/lib/tmdb';
import { isTv } from '@/lib/device';

// Na TV a fileira não tem foco (é só pra ver): mostra só quem cabe na largura, sem gente cortada na borda.
export const ELENCO_TV = 10;

const iniciais = (nome: string) => nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();

// Elenco na página do título (pedido dele 01/11/2026, foto aprovada): fotos redondas com o nome e o personagem,
// embaixo da sinopse. Sem elenco na TMDB (ou TMDB fora), a seção simplesmente não aparece.
export default function CastRow({ tmdbId, type }: { tmdbId: number; type: TmdbMediaType }) {
  const [elenco, setElenco] = useState<TmdbCastMember[] | null>(null);
  useEffect(() => {
    let vivo = true;
    getCredits(tmdbId, type)
      .then(c => { if (vivo) setElenco(c); })
      .catch(() => { if (vivo) setElenco([]); });
    return () => { vivo = false; };
  }, [tmdbId, type]);
  if (!elenco || elenco.length === 0) return null;
  const pessoas = isTv() ? elenco.slice(0, ELENCO_TV) : elenco;
  return (
    <div className="space-y-2 pt-2" data-elenco>
      <h2 className="text-sm font-semibold text-muted-foreground">Elenco</h2>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pessoas.map(p => (
          <div key={p.id} className="w-[76px] shrink-0 text-center">
            <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-muted ring-1 ring-border flex items-center justify-center text-sm font-semibold text-muted-foreground">
              {p.profileUrl
                ? <img src={p.profileUrl} alt={p.name} loading="lazy" draggable={false} className="w-full h-full object-cover" />
                : iniciais(p.name)}
            </div>
            <p className="mt-1.5 text-[11px] font-medium leading-tight line-clamp-2">{p.name}</p>
            {p.character && <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{p.character}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
