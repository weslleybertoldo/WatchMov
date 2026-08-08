import Fastify from 'fastify';
import { PROVIDERS } from './providers.js';
import { resolveEmbed } from './resolve.js';

const app = Fastify({ logger: true });
const ALL = Object.keys(PROVIDERS);

// CORS aberto (resolvedor público de leitura) + preflight
app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

app.get('/health', async () => ({ ok: true }));

// POST /resolve { tmdbId, imdbId, type, season, episode, providers?: string[] }
// -> { servers: [{ provider, label, url, referer, mime }] }
app.post('/resolve', async (req, reply) => {
  const b = req.body || {};
  const target = {
    type: b.type === 'tv' ? 'tv' : 'movie',
    tmdbId: b.tmdbId != null ? Number(b.tmdbId) : undefined,
    imdbId: b.imdbId || undefined,
    season: b.season != null ? Number(b.season) : undefined,
    episode: b.episode != null ? Number(b.episode) : undefined,
  };
  const wanted = Array.isArray(b.providers) && b.providers.length ? b.providers.filter((p) => ALL.includes(p)) : ALL;
  const jobs = wanted.map(async (pid) => {
    const url = PROVIDERS[pid].build(target);
    if (!url) return [];
    try {
      const streams = await resolveEmbed(url, { timeoutMs: Number(b.timeoutMs) || 20000 });
      return streams.map((s, i) => ({ provider: pid, label: `${PROVIDERS[pid].name}${streams.length > 1 ? ' ' + (i + 1) : ''}`, ...s }));
    } catch (e) {
      req.log.warn({ pid, err: String(e) }, 'resolve falhou');
      return [];
    }
  });
  const servers = (await Promise.all(jobs)).flat();
  return reply.send({ servers });
});

const port = Number(process.env.PORT) || 8080;
app.listen({ port, host: '0.0.0.0' }).then(() => app.log.info(`resolver on :${port}`));
