// Grava o favorito e acerta o sino — o mesmo caminho pro botão de pastinha da página do título e pro menu de
// "segurar" a capa. Separado de favorites.ts porque o sino fala com o Supabase e a capa não pode puxar isso.
import type { WatchItem } from '@/types/watch';
import { setNotify, clearNotify } from '@/lib/notifications';
import type { TipoTmdb } from '@/lib/favorites';

// Regra dele (notifications.ts): entrar LIGA o aviso — série sempre, filme só se ainda não estreou (filme lançado
// não tem o que avisar) —, sair APAGA a inscrição (voltar pros favoritos religa).
export function gravarFavorito(
  updateItem: (id: string, updates: Partial<WatchItem>) => void,
  item: WatchItem,
  favorito: boolean,
  titulo: { tmdbId: number; type: TipoTmdb; title: string; posterUrl?: string; emBreve: boolean },
) {
  updateItem(item.id, { favorite: favorito });
  if (favorito && (titulo.type === 'tv' || titulo.emBreve)) {
    void setNotify({ tmdbId: titulo.tmdbId, type: titulo.type, enabled: true, title: titulo.title, posterUrl: titulo.posterUrl });
  } else if (!favorito) {
    void clearNotify(titulo.tmdbId, titulo.type);
  }
}
