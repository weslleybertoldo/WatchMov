import { useState, useCallback, useEffect } from 'react';
import { AppData, Section, WatchItem, Season, DashboardStats } from '@/types/watch';

const STORAGE_KEY = 'watchtracker_data';

const defaultData: AppData = {
  sections: [
    { id: 'sec-1', name: 'Filmes', icon: '🎬', createdAt: new Date().toISOString() },
    { id: 'sec-2', name: 'Séries', icon: '📺', createdAt: new Date().toISOString() },
    { id: 'sec-3', name: 'Animes', icon: '⛩️', createdAt: new Date().toISOString() },
  ],
  items: [],
};

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaultData;
}

function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function generateId() {
  return Math.random().toString(36).substring(2, 12);
}

export function useWatchStore() {
  const [data, setData] = useState<AppData>(loadData);

  useEffect(() => {
    saveData(data);
  }, [data]);

  const updateData = useCallback((updater: (prev: AppData) => AppData) => {
    setData(prev => {
      const next = updater(prev);
      return next;
    });
  }, []);

  // Sections
  const addSection = useCallback((name: string, icon?: string) => {
    updateData(d => ({
      ...d,
      sections: [...d.sections, { id: generateId(), name, icon: icon || '📁', createdAt: new Date().toISOString() }],
    }));
  }, [updateData]);

  const updateSection = useCallback((id: string, updates: Partial<Section>) => {
    updateData(d => ({
      ...d,
      sections: d.sections.map(s => s.id === id ? { ...s, ...updates } : s),
    }));
  }, [updateData]);

  const deleteSection = useCallback((id: string) => {
    updateData(d => ({
      ...d,
      sections: d.sections.filter(s => s.id !== id),
      items: d.items.filter(i => i.sectionId !== id),
    }));
  }, [updateData]);

  // Items
  const addItem = useCallback((item: Omit<WatchItem, 'id' | 'createdAt'>) => {
    updateData(d => ({
      ...d,
      items: [...d.items, { ...item, id: generateId(), createdAt: new Date().toISOString() }],
    }));
  }, [updateData]);

  const updateItem = useCallback((id: string, updates: Partial<WatchItem>) => {
    updateData(d => ({
      ...d,
      items: d.items.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
  }, [updateData]);

  const deleteItem = useCallback((id: string) => {
    updateData(d => ({
      ...d,
      items: d.items.filter(i => i.id !== id),
    }));
  }, [updateData]);

  // Episode tracking
  const incrementEpisode = useCallback((itemId: string, seasonId: string) => {
    updateData(d => ({
      ...d,
      items: d.items.map(item => {
        if (item.id !== itemId || !item.seasons) return item;
        const seasons = item.seasons.map(s => {
          if (s.id !== seasonId) return s;
          if (s.watchedEpisodes >= s.totalEpisodes) return s;
          return { ...s, watchedEpisodes: s.watchedEpisodes + 1 };
        });
        return { ...item, seasons, lastWatchedAt: new Date().toISOString() };
      }),
    }));
  }, [updateData]);

  const decrementEpisode = useCallback((itemId: string, seasonId: string) => {
    updateData(d => ({
      ...d,
      items: d.items.map(item => {
        if (item.id !== itemId || !item.seasons) return item;
        const seasons = item.seasons.map(s => {
          if (s.id !== seasonId || s.watchedEpisodes <= 0) return s;
          return { ...s, watchedEpisodes: s.watchedEpisodes - 1 };
        });
        return { ...item, seasons, lastWatchedAt: new Date().toISOString() };
      }),
    }));
  }, [updateData]);

  const resetSeason = useCallback((itemId: string, seasonId: string) => {
    updateData(d => ({
      ...d,
      items: d.items.map(item => {
        if (item.id !== itemId || !item.seasons) return item;
        const seasons = item.seasons.map(s =>
          s.id === seasonId ? { ...s, watchedEpisodes: 0, partialEpisodeTime: undefined } : s
        );
        return { ...item, seasons };
      }),
    }));
  }, [updateData]);

  const resetItem = useCallback((itemId: string) => {
    updateData(d => ({
      ...d,
      items: d.items.map(item => {
        if (item.id !== itemId) return item;
        if (item.type === 'movie') {
          return { ...item, watchedDuration: 0, completed: false };
        }
        const seasons = item.seasons?.map(s => ({ ...s, watchedEpisodes: 0, partialEpisodeTime: undefined }));
        return { ...item, seasons };
      }),
    }));
  }, [updateData]);

  // Stats
  const getStats = useCallback((): DashboardStats => {
    const items = data.items;
    const series = items.filter(i => i.type === 'series');
    const movies = items.filter(i => i.type === 'movie');

    let totalEpisodesWatched = 0;
    let totalTimeWatched = 0;
    let totalTimeRemaining = 0;
    let completedItems = 0;

    series.forEach(s => {
      s.seasons?.forEach(season => {
        totalEpisodesWatched += season.watchedEpisodes;
        totalTimeWatched += season.watchedEpisodes * season.episodeDuration;
        totalTimeRemaining += (season.totalEpisodes - season.watchedEpisodes) * season.episodeDuration;
        if (season.partialEpisodeTime) {
          totalTimeWatched += season.partialEpisodeTime;
          totalTimeRemaining -= season.partialEpisodeTime;
        }
      });
      const allDone = s.seasons?.every(se => se.watchedEpisodes >= se.totalEpisodes);
      if (allDone && s.seasons && s.seasons.length > 0) completedItems++;
    });

    movies.forEach(m => {
      const watched = m.watchedDuration || 0;
      const total = m.totalDuration || 0;
      totalTimeWatched += watched;
      totalTimeRemaining += total - watched;
      if (m.completed || watched >= total) completedItems++;
    });

    return {
      totalItems: items.length,
      totalSeries: series.length,
      totalMovies: movies.length,
      totalEpisodesWatched,
      totalTimeWatched,
      totalTimeRemaining,
      completedItems,
    };
  }, [data.items]);

  return {
    data,
    addSection, updateSection, deleteSection,
    addItem, updateItem, deleteItem,
    incrementEpisode, decrementEpisode,
    resetSeason, resetItem,
    getStats,
  };
}
