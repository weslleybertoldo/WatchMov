import { PROVIDERS } from './providers.js';
import { resolveEmbed } from './resolve.js';

// Uso: node src/test-local.js <provider> <type> <tmdbId> [imdbId] [season] [episode]
// Ex.: node src/test-local.js embedplayapi movie 1311031
const [, , provider = 'embedplayapi', type = 'movie', tmdbId, imdbId, season, episode] = process.argv;
const target = {
  type,
  tmdbId: tmdbId ? Number(tmdbId) : undefined,
  imdbId: imdbId || undefined,
  season: season ? Number(season) : undefined,
  episode: episode ? Number(episode) : undefined,
};
const p = PROVIDERS[provider];
if (!p) { console.error('provider inválido:', Object.keys(PROVIDERS)); process.exit(1); }
const url = p.build(target);
console.log(`[${provider}] embed:`, url);
if (!url) { console.error('sem URL p/ esse target'); process.exit(1); }
const t0 = Date.now();
const streams = await resolveEmbed(url, { timeoutMs: 25000 });
console.log(`resolveu em ${Date.now() - t0}ms → ${streams.length} stream(s):`);
for (const s of streams) console.log(JSON.stringify(s, null, 2));
process.exit(0);
