// Construtores de URL de embed — espelham src/lib/players.ts do app.
// Cada provider recebe {tmdbId, imdbId, type:'movie'|'tv', season, episode}.
const s = (t) => t.season ?? 1;
const e = (t) => t.episode ?? 1;

export const PROVIDERS = {
  embedplayapi: {
    name: 'EmbedPlayApi',
    build: (t) => t.tmdbId == null ? null : (t.type === 'movie'
      ? `https://embedplayapi.top/embed/${t.tmdbId}`
      : `https://embedplayapi.top/embed/${t.tmdbId}/${s(t)}/${e(t)}`),
  },
  superflix: {
    name: 'SuperFlix',
    build: (t) => {
      const id = t.imdbId ?? t.tmdbId;
      if (id == null) return null;
      return t.type === 'movie'
        ? `https://superflixapi.cyou/filme/${id}`
        : `https://superflixapi.cyou/serie/${id}/${s(t)}/${e(t)}`;
    },
  },
  fembed: {
    name: 'Fembed',
    build: (t) => t.tmdbId == null ? null : (t.type === 'movie'
      ? `https://fembed.sx/e/${t.tmdbId}`
      : `https://fembed.sx/e/${t.tmdbId}/${s(t)}-${e(t)}`),
  },
  megaembed: {
    name: 'MegaEmbed',
    build: (t) => {
      const id = t.imdbId ?? t.tmdbId;
      if (id == null || t.type !== 'tv') return null;
      return `https://megaembedapi.site/embed/${id}?sea=${s(t)}&epi=${e(t)}`;
    },
  },
  myembed: {
    name: 'MyEmbed',
    build: (t) => {
      const id = t.imdbId ?? t.tmdbId;
      if (id == null) return null;
      return t.type === 'movie'
        ? `https://myembed.biz/filme/${id}`
        : `https://myembed.biz/serie/${id}/${s(t)}/${e(t)}`;
    },
  },
  playerflix: {
    name: 'PlayerFlix',
    build: (t) => t.tmdbId == null ? null : (t.type === 'movie'
      ? `https://playerflixapi.com/filme/${t.tmdbId}`
      : `https://playerflixapi.com/serie/${t.tmdbId}/${s(t)}/${e(t)}`),
  },
};
