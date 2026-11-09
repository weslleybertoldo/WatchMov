export interface Season {
  id: string;
  number: number;
  totalEpisodes: number;
  watchedEpisodes: number;
  episodeDuration: number; // minutes
  partialEpisodeTime?: number; // minutes watched of current episode
  watchedList?: number[]; // números dos episódios marcados como assistidos
}

// Último ponto tocado de um título, guardado no banco (coluna `wm_items.progress`). Filme: s = e = 0.
// pos/dur em ms; ts = epoch ms de quando aquele ponto tocou (relógio do aparelho que gravou).
export interface ProgressoRemoto {
  s: number;
  e: number;
  pos: number;
  dur?: number;
  ts: number;
}

export interface WatchItem {
  id: string;
  sectionId?: string; // opcional: itens de streaming (biblioteca) não têm seção
  title: string;
  type: 'movie' | 'series';
  // Movie fields
  totalDuration?: number; // minutes
  watchedDuration?: number; // minutes
  completed?: boolean;
  // Series fields
  seasons?: Season[];
  // Common fields
  comment?: string;
  lastWatchedAt?: string; // ISO date
  // "Remover da lista" do Continuar assistindo (pedido dele 07/11/2026): quando saiu da fileira. Volta sozinho quando
  // ele assiste de novo (lastWatchedAt mais novo); o progresso e os episódios marcados não mudam.
  continueHiddenAt?: string | null;
  // Minuto onde parou, valendo em todos os aparelhos (pedido dele 09/11/2026): o último ponto tocado do título, de
  // qualquer aparelho (coluna `progress`). Ver src/lib/progressoRemoto.ts.
  progress?: ProgressoRemoto | null;
  createdAt: string;
  // TMDB metadata
  tmdbId?: number;
  imdbId?: string;
  posterUrl?: string;
  synopsis?: string;
  genre?: string;
  favorite?: boolean;
  rating?: number; // nota TMDB 0-10
  votes?: number;  // quantidade de avaliações
}

export interface Section {
  id: string;
  name: string;
  icon?: string;
  createdAt: string;
}

export interface AppData {
  sections: Section[];
  items: WatchItem[];
}

// Stats
export interface DashboardStats {
  totalItems: number;
  totalSeries: number;
  totalMovies: number;
  totalEpisodesWatched: number;
  totalTimeWatched: number; // minutes
  totalTimeRemaining: number; // minutes
  completedItems: number;
}
