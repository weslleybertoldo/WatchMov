import { useState, useCallback, useEffect, useRef } from 'react';
import { AppData, Section, WatchItem, Season, DashboardStats } from '@/types/watch';
import { supabase } from '@/lib/supabase';

// ── Helpers ──

export function generateId(): string {
  return crypto.randomUUID();
}

function dbSectionToLocal(row: any): Section {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || '\uD83D\uDCC1',
    createdAt: row.created_at,
  };
}

function dbItemToLocal(row: any): WatchItem {
  return {
    id: row.id,
    sectionId: row.section_id,
    title: row.title,
    type: row.type,
    totalDuration: row.total_duration,
    watchedDuration: row.watched_duration || 0,
    completed: row.completed || false,
    seasons: row.seasons || undefined,
    comment: row.comment || undefined,
    lastWatchedAt: row.last_watched_at || undefined,
    createdAt: row.created_at,
  };
}

const DEFAULT_SECTIONS = [
  { name: 'Filmes', icon: '\uD83C\uDFAC' },
  { name: 'Series', icon: '\uD83D\uDCFA' },
  { name: 'Animes', icon: '\u26E9\uFE0F' },
];

// ── Store Hook ──

export function useWatchStore(userId?: string) {
  const [data, setData] = useState<AppData>({ sections: [], items: [] });
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  // ── Load from Supabase ──
  const loadFromDB = useCallback(async () => {
    if (!userId) return;

    const [secRes, itemRes] = await Promise.all([
      supabase.from('wm_sections').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('wm_items').select('*').eq('user_id', userId).order('created_at'),
    ]);

    let sections = (secRes.data || []).map(dbSectionToLocal);
    const items = (itemRes.data || []).map(dbItemToLocal);

    // Seed default sections for new users
    if (sections.length === 0 && !loadedRef.current) {
      const inserts = DEFAULT_SECTIONS.map(s => ({
        user_id: userId,
        name: s.name,
        icon: s.icon,
      }));
      const { data: inserted } = await supabase.from('wm_sections').insert(inserts).select();
      if (inserted) sections = inserted.map(dbSectionToLocal);
    }

    loadedRef.current = true;
    setData({ sections, items });
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    loadedRef.current = false;
    setLoading(true);
    loadFromDB();
  }, [loadFromDB]);

  // ── Section CRUD ──

  const addSection = useCallback(async (name: string, icon?: string) => {
    if (!userId) return;
    const { data: inserted, error } = await supabase
      .from('wm_sections')
      .insert({ user_id: userId, name, icon: icon || '\uD83D\uDCC1' })
      .select()
      .single();
    if (error || !inserted) return;
    setData(prev => ({
      ...prev,
      sections: [...prev.sections, dbSectionToLocal(inserted)],
    }));
  }, [userId]);

  const updateSection = useCallback(async (id: string, updates: Partial<Section>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
    await supabase.from('wm_sections').update(dbUpdates).eq('id', id);
    setData(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === id ? { ...s, ...updates } : s),
    }));
  }, []);

  const deleteSection = useCallback(async (id: string) => {
    await supabase.from('wm_items').delete().eq('section_id', id);
    await supabase.from('wm_sections').delete().eq('id', id);
    setData(prev => ({
      ...prev,
      sections: prev.sections.filter(s => s.id !== id),
      items: prev.items.filter(i => i.sectionId !== id),
    }));
  }, []);

  // ── Item CRUD ──

  const addItem = useCallback(async (item: Omit<WatchItem, 'id' | 'createdAt'>) => {
    if (!userId) return;
    const row: any = {
      user_id: userId,
      section_id: item.sectionId,
      title: item.title,
      type: item.type,
      total_duration: item.totalDuration || null,
      watched_duration: item.watchedDuration || 0,
      completed: item.completed || false,
      seasons: item.seasons || null,
      comment: item.comment || null,
    };
    const { data: inserted, error } = await supabase.from('wm_items').insert(row).select().single();
    if (error || !inserted) return;
    setData(prev => ({
      ...prev,
      items: [...prev.items, dbItemToLocal(inserted)],
    }));
  }, [userId]);

  const updateItem = useCallback(async (id: string, updates: Partial<WatchItem>) => {
    const dbUpdates: any = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.totalDuration !== undefined) dbUpdates.total_duration = updates.totalDuration;
    if (updates.watchedDuration !== undefined) dbUpdates.watched_duration = updates.watchedDuration;
    if (updates.completed !== undefined) dbUpdates.completed = updates.completed;
    if (updates.seasons !== undefined) dbUpdates.seasons = updates.seasons;
    if (updates.comment !== undefined) dbUpdates.comment = updates.comment;
    if (updates.lastWatchedAt !== undefined) dbUpdates.last_watched_at = updates.lastWatchedAt;

    await supabase.from('wm_items').update(dbUpdates).eq('id', id);
    setData(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    await supabase.from('wm_items').delete().eq('id', id);
    setData(prev => ({
      ...prev,
      items: prev.items.filter(i => i.id !== id),
    }));
  }, []);

  // ── Episode tracking ──

  const incrementEpisode = useCallback(async (itemId: string, seasonId: string) => {
    let updatedSeasons: Season[] | undefined;
    const lastWatchedAt = new Date().toISOString();

    setData(prev => {
      const items = prev.items.map(item => {
        if (item.id !== itemId || !item.seasons) return item;
        const seasons = item.seasons.map(s => {
          if (s.id !== seasonId || s.watchedEpisodes >= s.totalEpisodes) return s;
          return { ...s, watchedEpisodes: s.watchedEpisodes + 1 };
        });
        updatedSeasons = seasons;
        return { ...item, seasons, lastWatchedAt };
      });
      return { ...prev, items };
    });

    if (updatedSeasons) {
      await supabase.from('wm_items').update({ seasons: updatedSeasons, last_watched_at: lastWatchedAt }).eq('id', itemId);
    }
  }, []);

  const decrementEpisode = useCallback(async (itemId: string, seasonId: string) => {
    let updatedSeasons: Season[] | undefined;
    const lastWatchedAt = new Date().toISOString();

    setData(prev => {
      const items = prev.items.map(item => {
        if (item.id !== itemId || !item.seasons) return item;
        const seasons = item.seasons.map(s => {
          if (s.id !== seasonId || s.watchedEpisodes <= 0) return s;
          return { ...s, watchedEpisodes: s.watchedEpisodes - 1 };
        });
        updatedSeasons = seasons;
        return { ...item, seasons, lastWatchedAt };
      });
      return { ...prev, items };
    });

    if (updatedSeasons) {
      await supabase.from('wm_items').update({ seasons: updatedSeasons, last_watched_at: lastWatchedAt }).eq('id', itemId);
    }
  }, []);

  const resetSeason = useCallback(async (itemId: string, seasonId: string) => {
    let updatedSeasons: Season[] | undefined;

    setData(prev => {
      const items = prev.items.map(item => {
        if (item.id !== itemId || !item.seasons) return item;
        const seasons = item.seasons.map(s =>
          s.id === seasonId ? { ...s, watchedEpisodes: 0, partialEpisodeTime: undefined } : s
        );
        updatedSeasons = seasons;
        return { ...item, seasons };
      });
      return { ...prev, items };
    });

    if (updatedSeasons) {
      await supabase.from('wm_items').update({ seasons: updatedSeasons }).eq('id', itemId);
    }
  }, []);

  const resetItem = useCallback(async (itemId: string) => {
    let dbUpdate: Record<string, any> | undefined;

    setData(prev => {
      const items = prev.items.map(item => {
        if (item.id !== itemId) return item;
        if (item.type === 'movie') {
          dbUpdate = { watched_duration: 0, completed: false };
          return { ...item, watchedDuration: 0, completed: false };
        }
        const seasons = item.seasons?.map(s => ({ ...s, watchedEpisodes: 0, partialEpisodeTime: undefined }));
        dbUpdate = { seasons };
        return { ...item, seasons };
      });
      return { ...prev, items };
    });

    if (dbUpdate) {
      await supabase.from('wm_items').update(dbUpdate).eq('id', itemId);
    }
  }, []);

  // ── Stats ──

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
        const remaining = (season.totalEpisodes - season.watchedEpisodes) * season.episodeDuration;
        if (season.partialEpisodeTime) {
          totalTimeWatched += season.partialEpisodeTime;
          totalTimeRemaining += Math.max(0, remaining - season.partialEpisodeTime);
        } else {
          totalTimeRemaining += remaining;
        }
      });
      const allDone = s.seasons?.every(se => se.watchedEpisodes >= se.totalEpisodes);
      if (allDone && s.seasons && s.seasons.length > 0) completedItems++;
    });

    movies.forEach(m => {
      const watched = m.watchedDuration || 0;
      const total = m.totalDuration || 0;
      totalTimeWatched += watched;
      totalTimeRemaining += Math.max(0, total - watched);
      if (m.completed || watched >= total) completedItems++;
    });

    return {
      totalItems: items.length,
      totalSeries: series.length,
      totalMovies: movies.length,
      totalEpisodesWatched,
      totalTimeWatched,
      totalTimeRemaining: Math.max(0, totalTimeRemaining),
      completedItems,
    };
  }, [data.items]);

  return {
    data,
    loading,
    addSection, updateSection, deleteSection,
    addItem, updateItem, deleteItem,
    incrementEpisode, decrementEpisode,
    resetSeason, resetItem,
    getStats,
  };
}
