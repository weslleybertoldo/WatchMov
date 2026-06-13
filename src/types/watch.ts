export interface Season {
  id: string;
  number: number;
  totalEpisodes: number;
  watchedEpisodes: number;
  episodeDuration: number; // minutes
  partialEpisodeTime?: number; // minutes watched of current episode
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
