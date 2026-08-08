import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const url = process.argv[2] || 'https://embedplayapi.top/embed/969681';
const KILL = ['disable-devtool', 'metricas.site', 'doubleclick', 'googlesyndication', 'popads', 'popcash', 'propellerads', 'onclickalgo', 'histats', 'adsterra'];
const hosts = new Set(); const media = [];
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'] });
const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 412, height: 892 } });
// stealth mínimo
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
await page.route('**/*', (r) => { const u = r.request().url().toLowerCase(); if (KILL.some((k) => u.includes(k))) return r.abort().catch(() => {}); return r.continue().catch(() => {}); });
page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch {} if (/\.(m3u8|mpd|mp4|m4s|txt)(\?|#|$)/i.test(r.url()) || /\/m3\//i.test(r.url())) media.push(r.url()); });
console.log('GOTO', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('goto err', String(e)));
await page.waitForTimeout(3500);
console.log('TITLE:', await page.title().catch(() => '?'));
console.log('FRAMES:', page.frames().map((f) => f.url()).slice(0, 8));
const btns = await page.evaluate(() => { const out = []; document.querySelectorAll('button,a,[onclick],[class*="option"],[class*="opcao"],[class*="server"],[class*="lang"],[data-],li').forEach((el) => { const t = (el.innerText || '').trim().slice(0, 30); if (t) out.push(el.tagName + '.' + String(el.className).slice(0, 25) + ' » ' + t); }); return out.slice(0, 25); });
console.log('CLICKABLES:', JSON.stringify(btns));
await page.screenshot({ path: 'dbg-1-load.png' }).catch(() => {});
// clicar 1ª opção de áudio/servidor e esperar iframe do player
for (const f of page.frames()) {
  for (const sel of ['text=/Op..o 1/i', 'text=/DUBLADO/i', '[class*="option"]', '[class*="server"]', 'li', '.play', 'video', '#player', '.jw-icon-display']) {
    try { const el = await f.$(sel); if (el) { await el.click({ timeout: 900, force: true }).catch(() => {}); } } catch {}
  }
}
await page.waitForTimeout(9000);
await page.screenshot({ path: 'dbg-2-afterclick.png' }).catch(() => {});
console.log('HOSTS:\n  ' + [...hosts].sort().join('\n  '));
console.log('MEDIA:', media.slice(0, 25));
await b.close(); process.exit(0);
