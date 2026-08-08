import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// Domínios que QUEBRAM a página (anti-devtool) ou são ads/tracker — abortados p/ renderizar e acelerar.
const BLOCKED = [
  'disable-devtool',            // ⚠️ blanka a página ao detectar automação — bloquear é essencial
  'metricas.site', 'whos.amung', 'amung.us', 'pixel.morphify', 'morphify.net', 'histats',
  'doubleclick', 'googlesyndication', 'googletagmanager', 'google-analytics', 'adservice',
  'popads', 'popcash', 'propellerads', 'propu.', 'adnxs', 'onclickalgo', 'hilltopads',
  'juicyads', 'exoclick', 'trafficjunky', 'mgid', 'revcontent', 'outbrain', 'taboola',
  'adsterra', 'a-ads', 'onclick', '/ads/', 'brwin.games', 'cloudflare-terms-of-service-abuse',
];
const VIDEO_RE = /\.(m3u8|mpd|mp4|m4s)(\?|#|$)/i;

const isBlocked = (u) => { const l = u.toLowerCase(); return BLOCKED.some((b) => l.includes(b)); };
const looksVideo = (u) => {
  if (isBlocked(u)) return false;
  const l = u.toLowerCase();
  return VIDEO_RE.test(l) || /master\.(m3u8|txt)/.test(l) || l.includes('.m3u8') || /\/m3\/[a-z0-9]+/i.test(l)
    || (l.includes('storage.googleapis.com') && l.includes('mediastorage'));
};
const mimeFor = (u) => {
  const l = u.toLowerCase();
  if (l.includes('.mpd')) return 'application/dash+xml';
  if (l.includes('.m3u8') || l.includes('master') || l.includes('/m3/') || (l.includes('.txt') && !l.includes('.mp4'))) return 'application/vnd.apple.mpegurl';
  return 'video/mp4';
};

const STEALTH = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
};

async function tryPlay(page) {
  const selectors = [
    'text=/Op..o 1/i', 'text=/DUBLADO/i', '[class*="option"]', '[class*="server"]',
    '.jw-icon-display', '.vjs-big-play-button', '.plyr__control--overlaid', 'video', '#player', '.play', 'li',
  ];
  for (const f of page.frames()) {
    for (const sel of selectors) {
      try { const el = await f.$(sel); if (el) await el.click({ timeout: 800, force: true }).catch(() => {}); } catch { /* ignore */ }
    }
  }
  try { const vp = page.viewportSize(); await page.mouse.click(vp.width / 2, vp.height / 2); } catch { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function resolveEmbed(embedUrl, { timeoutMs = 22000 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
  });
  const found = new Map();
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 412, height: 892 } });
    await ctx.addInitScript(STEALTH);
    const page = await ctx.newPage();

    await page.route('**/*', (route) => {
      if (isBlocked(route.request().url())) return route.abort().catch(() => {});
      return route.continue().catch(() => {});
    });

    const capture = (u, headers) => {
      if (!looksVideo(u)) return;
      const key = u.split('?')[0];
      if (found.has(key)) return;
      found.set(key, { url: u, referer: (headers && (headers.referer || headers.Referer)) || embedUrl, mime: mimeFor(u) });
    };
    page.on('request', (req) => capture(req.url(), req.headers()));
    page.on('response', (res) => { const ct = (res.headers()['content-type'] || '').toLowerCase(); if (ct.includes('mpegurl') || ct.includes('dash+xml') || ct.includes('mp2t')) capture(res.url(), res.request().headers()); });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
    await sleep(3000); // deixa o iframe do player carregar
    await tryPlay(page).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && found.size === 0) { await sleep(500); }
    if (found.size > 0) await sleep(1200); // grace p/ master além do 1º segmento
  } finally {
    await browser.close().catch(() => {});
  }
  return [...found.values()].sort((a, b) => (b.url.includes('master') ? 1 : 0) - (a.url.includes('master') ? 1 : 0));
}
