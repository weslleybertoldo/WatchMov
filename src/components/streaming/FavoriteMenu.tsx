import { useRef } from 'react';
import type { MediaSummary } from '@/lib/tmdb';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BookmarkMinus, BookmarkPlus, Film, ListX, Tv, X } from 'lucide-react';

interface FavoriteMenuProps {
  aberto: boolean;
  // Capa que foi segurada e se era favorita na hora. Fica guardada depois de fechar, pra animação de saída não
  // mostrar a caixa vazia.
  // `continuar`: a capa segurada é do Continuar assistindo — só aí aparece o "Remover da lista" (pedido dele 07/11/2026).
  alvo: { media: MediaSummary; favorito: boolean; continuar?: boolean } | null;
  onAlternar: (m: MediaSummary, favoritar: boolean) => void;
  onRemoverDaLista?: (m: MediaSummary) => void;
  onFechar: () => void;
}

// Menu de segurar a capa (pedido dele 01/11/2026): o título, se já está nos favoritos e a ação de pôr/tirar com o
// foco nela (na TV o OK confirma direto; Voltar ou Cancelar fecham sem mudar nada).
export default function FavoriteMenu({ aberto, alvo, onAlternar, onRemoverDaLista, onFechar }: FavoriteMenuProps) {
  const media = alvo?.media;
  const favorito = !!alvo?.favorito;
  const removerDaLista = alvo?.continuar && onRemoverDaLista ? onRemoverDaLista : null;
  const acao = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={aberto && !!alvo} onOpenChange={(abrir) => { if (!abrir) onFechar(); }}>
      {/* O Radix põe o foco no Cancelar; aqui ele vai pra ação (na TV o OK confirma direto, como na foto aprovada). */}
      <AlertDialogContent className="max-w-sm p-5 gap-4"
        onOpenAutoFocus={(e) => { if (acao.current) { e.preventDefault(); acao.current.focus(); } }}>
        {media && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-12 shrink-0 aspect-[2/3] rounded-md overflow-hidden bg-muted flex items-center justify-center text-muted-foreground">
                {media.posterUrl
                  ? <img src={media.posterUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                  : media.type === 'tv' ? <Tv className="w-5 h-5" /> : <Film className="w-5 h-5" />}
              </div>
              <div className="min-w-0 text-left">
                <AlertDialogTitle className="text-base leading-tight line-clamp-2">{media.title}</AlertDialogTitle>
                <AlertDialogDescription className="text-xs mt-1">
                  {favorito ? 'Está nos seus favoritos' : 'Não está nos favoritos'}
                </AlertDialogDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <AlertDialogAction ref={acao} data-tv-autofocus className="w-full justify-start gap-2.5 h-11"
                onClick={() => onAlternar(media, !favorito)}>
                {favorito ? <BookmarkMinus className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                {favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              </AlertDialogAction>
              {removerDaLista && (
                <AlertDialogAction className="w-full justify-start gap-2.5 h-11 border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => removerDaLista(media)}>
                  <ListX className="w-4 h-4" /> Remover da lista
                </AlertDialogAction>
              )}
              <AlertDialogCancel className="w-full justify-start gap-2.5 h-11 mt-0 sm:mt-0">
                <X className="w-4 h-4" /> Cancelar
              </AlertDialogCancel>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
