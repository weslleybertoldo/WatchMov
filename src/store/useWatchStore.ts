import { useState, useCallback, useEffect, useRef } from 'react';
import { AppData, Section, WatchItem, Season, DashboardStats } from '@/types/watch';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// ── Helpers ──

export function generateId(): string {
  return crypto.randomUUID();
}

interface DbSectionRow {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  created_at: string;
}

interface DbItemRow {
  id: string;
  user_id: string;
  section_id: string | null;
  title: string;
  type: 'movie' | 'series';
  total_duration: number | null;
  watched_duration: number | null;
  completed: boolean | null;
  seasons: Season[] | null;
  comment: string | null;
  last_watched_at: string | null;
  created_at: string;
  tmdb_id: number | null;
  imdb_id: string | null;
  poster_url: string | null;
  synopsis: string | null;
  genre: string | null;
  favorite: boolean | null;
  rating: number | null;
  votes: number | null;
}

function dbSectionToLocal(row: DbSectionRow): Section {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || '📁',
    createdAt: row.created_at,
  };
}

function dbItemToLocal(row: DbItemRow): WatchItem {
  return {
    id: row.id,
    sectionId: row.section_id ?? undefined,
    title: row.title,
    type: row.type,
    totalDuration: row.total_duration ?? undefined,
    watchedDuration: row.watched_duration ?? 0,
    completed: row.completed ?? false,
    seasons: row.seasons ?? undefined,
    comment: row.comment ?? undefined,
    lastWatchedAt: row.last_watched_at ?? undefined,
    createdAt: row.created_at,
    tmdbId: row.tmdb_id ?? undefined,
    imdbId: row.imdb_id ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    synopsis: row.synopsis ?? undefined,
    genre: row.genre ?? undefined,
    favorite: row.favorite ?? false,
    rating: row.rating ?? undefined,
    votes: row.votes ?? undefined,
  };
}

function reportDbError(action: string, error: unknown) {
  const msg = error instanceof Error ? error.message : (typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : 'erro desconhecido');
  console.error(`[WatchStore] ${action}:`, error);
  toast.error(`Falha ao ${action}`, { description: msg });
}

const DEFAULT_SECTIONS = [
  { name: 'Filmes', icon: '🎬' },
  { name: 'Series', icon: '📺' },
  { name: 'Animes', icon: '⛩️' },
];

// ── Store Hook ──

export function useWatchStore(userId?: string) {
  const [data, setData] = useState<AppData>({ sections: [], items: [] });
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const itemsRef = useRef<WatchItem[]>([]);

  // Keep ref in sync to avoid stale closures in increment/decrement
  useEffect(() => {
    itemsRef.current = data.items;
  }, [data.items]);

  // ── Load from Supabase ──
  const loadFromDB = useCallback(async () => {
    if (!userId) return;

    const [secRes, itemRes] = await Promise.all([
      supabase.from('wm_sections').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('wm_items').select('*').eq('user_id', userId).order('created_at'),
    ]);

    if (secRes.error) reportDbError('carregar secoes', secRes.error);
    if (itemRes.error) reportDbError('carregar itens', itemRes.error);

    let sections = (secRes.data || []).map(dbSectionToLocal);
    const items = (itemRes.data || []).map(dbItemToLocal);

    // Seed default sections for new users
    if (sections.length === 0 && !loadedRef.current && !secRes.error) {
      const inserts = DEFAULT_SECTIONS.map(s => ({
        user_id: userId,
        name: s.name,
        icon: s.icon,
      }));
      const { data: inserted, error } = await supabase.from('wm_sections').insert(inserts).select();
      if (error) reportDbError('criar secoes padrao', error);
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
      .insert({ user_id: userId, name, icon: icon || '📁' })
      .select()
      .single();
    if (error || !inserted) {
      reportDbError('adicionar secao', error);
      return;
    }
    setData(prev => ({
      ...prev,
      sections: [...prev.sections, dbSectionToLocal(inserted)],
    }));
  }, [userId]);

  const updateSection = useCallback(async (id: string, updates: Partial<Section>) => {
    const dbUpdates: { name?: string; icon?: string } = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
    // optimistic
    setData(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === id ? { ...s, ...updates } : s),
    }));
    const { error } = await supabase.from('wm_sections').update(dbUpdates).eq('id', id);
    if (error) {
      reportDbError('atualizar secao', error);
      loadFromDB();
    }
  }, [loadFromDB]);

  const deleteSection = useCallback(async (id: string) => {
    // optimistic — FK ON DELETE CASCADE remove os itens automaticamente
    setData(prev => ({
      ...prev,
      sections: prev.sections.filter(s => s.id !== id),
      items: prev.items.filter(i => i.sectionId !== id),
    }));
    const { error } = await supabase.from('wm_sections').delete().eq('id', id);
    if (error) {
      reportDbError('excluir secao', error);
      loadFromDB();
    }
  }, [loadFromDB]);

  // ── Item CRUD ──

  const addItem = useCallback(async (item: Omit<WatchItem, 'id' | 'createdAt'>) => {
    if (!userId) return;
    const row = {
      user_id: userId,
      section_id: item.sectionId ?? null,
      title: item.title,
      type: item.type,
      total_duration: item.totalDuration ?? null,
      watched_duration: item.watchedDuration ?? 0,
      completed: item.completed ?? false,
      seasons: item.seasons ?? null,
      comment: item.comment ?? null,
      tmdb_id: item.tmdbId ?? null,
      imdb_id: item.imdbId ?? null,
      poster_url: item.posterUrl ?? null,
      synopsis: item.synopsis ?? null,
      genre: item.genre ?? null,
      favorite: item.favorite ?? false,
      rating: item.rating ?? null,
      votes: item.votes ?? null,
    };
    const { data: inserted, error } = await supabase.from('wm_items').insert(row).select().single();
    if (error || !inserted) {
      reportDbError('adicionar item', error);
      return;
    }
    setData(prev => ({
      ...prev,
      items: [...prev.items, dbItemToLocal(inserted)],
    }));
  }, [userId]);

  const updateItem = useCallback(async (id: string, updates: Partial<WatchItem>) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.sectionId !== undefined) dbUpdates.section_id = updates.sectionId;
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.totalDuration !== undefined) dbUpdates.total_duration = updates.totalDuration;
    if (updates.watchedDuration !== undefined) dbUpdates.watched_duration = updates.watchedDuration;
    if (updates.completed !== undefined) dbUpdates.completed = updates.completed;
    if (updates.seasons !== undefined) dbUpdates.seasons = updates.seasons;
    if (updates.comment !== undefined) dbUpdates.comment = updates.comment;
    if (updates.lastWatchedAt !== undefined) dbUpdates.last_watched_at = updates.lastWatchedAt;
    if (updates.tmdbId !== undefined) dbUpdates.tmdb_id = updates.tmdbId;
    if (updates.imdbId !== undefined) dbUpdates.imdb_id = updates.imdbId;
    if (updates.posterUrl !== undefined) dbUpdates.poster_url = updates.posterUrl;
    if (updates.synopsis !== undefined) dbUpdates.synopsis = updates.synopsis;
    if (updates.genre !== undefined) dbUpdates.genre = updates.genre;
    if (updates.favorite !== undefined) dbUpdates.favorite = updates.favorite;
    if (updates.rating !== undefined) dbUpdates.rating = updates.rating;
    if (updates.votes !== undefined) dbUpdates.votes = updates.votes;

    // optimistic
    setData(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
    const { error } = await supabase.from('wm_items').update(dbUpdates).eq('id', id);
    if (error) {
      reportDbError('atualizar item', error);
      loadFromDB();
    }
  }, [loadFromDB]);

  const deleteItem = useCallback(async (id: string) => {
    // optimistic
    setData(prev => ({
      ...prev,
      items: prev.items.filter(i => i.id !== id),
    }));
    const { error } = await supabase.from('wm_items').delete().eq('id', id);
    if (error) {
      reportDbError('excluir item', error);
      loadFromDB();
    }
  }, [loadFromDB]);

  // ── Episode tracking ──
  // Anti-race: serializa writes por itemId em uma fila simples (last-write-wins
  // intencional, mas garante que reads usem a ultima versao do estado).
  const writeQueueRef = useRef<Map<string, Promise<void>>>(new Map());

  const enqueueItemWrite = useCallback((itemId: string, op: () => Promise<void>) => {
    const prev = writeQueueRef.current.get(itemId) ?? Promise.resolve();
    const next = prev
      .then(op)
      .catch((err) => {
        console.error(`[WatchStore] write queue ${itemId}:`, err);
      })
      .finally(() => {
        // Limpa entrada se for a ultima da fila (evita vazamento do Map).
        if (writeQueueRef.current.get(itemId) === next) {
          writeQueueRef.current.delete(itemId);
        }
      });
    writeQueueRef.current.set(itemId, next);
    return next;
  }, []);

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
      const seasonsSnapshot = updatedSeasons;
      enqueueItemWrite(itemId, async () => {
        // Re-read latest from ref to send the freshest version, mitigating
        // out-of-order writes on rapid increment/decrement clicks.
        const current = itemsRef.current.find(i => i.id === itemId);
        const seasons = current?.seasons ?? seasonsSnapshot;
        const { error } = await supabase.from('wm_items')
          .update({ seasons, last_watched_at: lastWatchedAt })
          .eq('id', itemId);
        if (error) {
          reportDbError('salvar episodio', error);
          loadFromDB();
        }
      });
    }
  }, [enqueueItemWrite, loadFromDB]);

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
      const seasonsSnapshot = updatedSeasons;
      enqueueItemWrite(itemId, async () => {
        const current = itemsRef.current.find(i => i.id === itemId);
        const seasons = current?.seasons ?? seasonsSnapshot;
        const { error } = await supabase.from('wm_items')
          .update({ seasons, last_watched_at: lastWatchedAt })
          .eq('id', itemId);
        if (error) {
          reportDbError('salvar episodio', error);
          loadFromDB();
        }
      });
    }
  }, [enqueueItemWrite, loadFromDB]);

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
      const snapshot = updatedSeasons;
      enqueueItemWrite(itemId, async () => {
        const { error } = await supabase.from('wm_items').update({ seasons: snapshot }).eq('id', itemId);
        if (error) {
          reportDbError('zerar temporada', error);
          loadFromDB();
        }
      });
    }
  }, [enqueueItemWrite, loadFromDB]);

  const resetItem = useCallback(async (itemId: string) => {
    let dbUpdate: Record<string, unknown> | undefined;

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
      const snapshot = dbUpdate;
      enqueueItemWrite(itemId, async () => {
        const { error } = await supabase.from('wm_items').update(snapshot).eq('id', itemId);
        if (error) {
          reportDbError('resetar item', error);
          loadFromDB();
        }
      });
    }
  }, [enqueueItemWrite, loadFromDB]);

  // ── Biblioteca de streaming (itens por título TMDB, sem seção) ──

  const upsertLibraryItem = useCallback(async (media: {
    tmdbId: number;
    type: 'movie' | 'series';
    title: string;
    imdbId?: string;
    posterUrl?: string;
    synopsis?: string;
    genre?: string;
    rating?: number;
    votes?: number;
    totalDuration?: number;
    seasons?: Season[];
  }): Promise<WatchItem | null> => {
    if (!userId) return null;
    const existing = itemsRef.current.find(i => i.tmdbId === media.tmdbId && i.type === media.type);
    if (existing) return existing;
    const row = {
      user_id: userId,
      section_id: null,
      title: media.title,
      type: media.type,
      total_duration: media.totalDuration ?? null,
      watched_duration: 0,
      completed: false,
      seasons: media.seasons ?? null,
      comment: null,
      tmdb_id: media.tmdbId,
      imdb_id: media.imdbId ?? null,
      poster_url: media.posterUrl ?? null,
      synopsis: media.synopsis ?? null,
      genre: media.genre ?? null,
      favorite: false,
      rating: media.rating ?? null,
      votes: media.votes ?? null,
    };
    const { data: inserted, error } = await supabase.from('wm_items').insert(row).select().single();
    if (error || !inserted) {
      reportDbError('adicionar a biblioteca', error);
      return null;
    }
    const item = dbItemToLocal(inserted);
    setData(prev => ({ ...prev, items: [...prev.items, item] }));
    return item;
  }, [userId]);

  // Selectors de streaming
  // Inclui também itens só abertos (lastWatchedAt) — players BR não disparam evento
  // de progresso/conclusão, então séries não acumulariam watchedEpisodes.
  const continueWatching = data.items
    .filter(i => !i.completed && ((i.watchedDuration || 0) > 0 || (i.seasons?.some(s => s.watchedEpisodes > 0) ?? false) || !!i.lastWatchedAt))
    .sort((a, b) => (b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0) - (a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0));

  const myList = data.items
    .filter(i => i.favorite)
    .sort((a, b) => (b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0) - (a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0));

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
    upsertLibraryItem,
    continueWatching,
    myList,
  };
}
