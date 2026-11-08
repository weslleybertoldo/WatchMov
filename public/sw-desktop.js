// Service worker SÓ do app do Windows (registrado em src/main.tsx quando window.wmDesktop existe; no navegador ele
// nunca é registrado). Guarda a interface do app pra abrir SEM internet e assistir o que foi baixado (W4).
// · instalação: guarda a página e todos os arquivos do build (lista em /wm-arquivos.json, gerada pelo vite.config.ts);
// · /assets/* (nome com hash, nunca muda): do cache, senão da rede (e guarda);
// · a página: SÓ quando o app pede a cópia sem internet (?offline=1, desktop/main.ts). Com internet a página vem da rede
//   como sempre (o app do Windows ajusta a CSP dela; uma cópia guardada não teria isso).
const VERSAO = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE = `wm-desktop-${VERSAO}`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const lista = await fetch('/wm-arquivos.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    // Um por um: um arquivo que falha não derruba o resto (o addAll é tudo ou nada).
    await Promise.all(['/', ...lista.map((f) => `/${f}`)].map((u) =>
      fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? c.put(u, r) : undefined)).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('wm-desktop-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate') {
    if (u.searchParams.has('offline')) {
      e.respondWith(caches.open(CACHE).then((c) => c.match('/')).then((p) => p || Response.error()));
    }
    return;
  }
  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const guardado = await c.match(r, { ignoreSearch: true });
      if (guardado) return guardado;
      const resp = await fetch(r);
      if (resp.ok) c.put(r, resp.clone()).catch(() => undefined);
      return resp;
    }));
    return;
  }
  // O resto do próprio site (fontes, logos): da rede; sem internet, a cópia guardada.
  e.respondWith(fetch(r).catch(() => caches.open(CACHE).then((c) => c.match(r, { ignoreSearch: true })).then((p) => p || Response.error())));
});
