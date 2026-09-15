// src/lib/resolver.ts
import { useEffect, useState } from 'react';
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

// Resolvedor OCULTO (pedido dele 14/09/2026: "quando clicar em assistir abra direto no
// reprodutor"). O nativo (ResolverPlugin.java) carrega a página da fonte num WebView invisível
// com o mesmo UA/cookies do app, faz frame-hop pros players em iframe de host conhecido e roda
// o clickScript abaixo a cada 1,5 s. O link capturado chega pelo MESMO streamFound do sniffer;
// quem abre o reprodutor é o auto-abrir do VideoPlayer. Aqui: wrapper do plugin, receita de
// cliques, toggle (padrão ligado) e pausa por fonte (3 timeouts seguidos na MESMA versão → 2 h).

export interface ResolverEvent { type: 'loaded' | 'hop' | 'click' | 'timeout' | 'abyss'; url: string; hops?: number }
interface ResolverPlugin {
  start(o: { url: string; referer?: string; hopHosts: string[]; clickScript: string; injectScript: string; injectScriptAlt?: string; abyssSid?: string; fallbackMs?: number; budgetMs: number }): Promise<void>;
  stop(o?: { keep?: boolean }): Promise<void>;
  addListener(event: 'resolverEvent', cb: (e: ResolverEvent) => void): Promise<PluginListenerHandle>;
}
const Resolver = registerPlugin<ResolverPlugin>('Resolver');

// Orçamento por fonte (15/09/2026): Fonte 1 = ABYS (~10–30 s até o proxy dizer "ready") + fallback Byse
// aos 30 s sem sinal do frame abysscdn (ou aos 60 s se o pump já leu as `sources` — /abyss/progress) →
// 90 s; demais fontes seguem 45 s (Fonte 6 playerflix→Blogger leva ~24–27 s).
export const RESOLVER_BUDGET_MS = 45000;
export const RESOLVER_BUDGET_ABYS_MS = 90000;
export const ABYS_FALLBACK_MS = 30000;
export const PROXY_PORT = 8099;   // ProxyServer.PORT
export const ABYS_PROVIDER = 'embedplayapi';   // Fonte 1: "Mostrar Opções" → Opção 1 (ABYS) / Opção 2 (BYSE)
export function budgetFor(providerId: string): number { return providerId === ABYS_PROVIDER ? RESOLVER_BUDGET_ABYS_MS : RESOLVER_BUDGET_MS; }
// Iframes de player em que é preciso CLICAR (opção/gate) → frame-hop (só no fallback sem injeção).
export const HOP_HOSTS = ['playerflix.ink', 'embedplay.one', 'f7hyg4q.org'];
// Ordem importa: 1 clique por tick e no máximo 1 por seletor por página. "text:" = por texto.
const STEPS_TAIL = [
  '#optionList .option', '.option',      // playerflix (1ª = Blogger)
  '.captcha-gate__play',                 // f7hyg4q.org (Byse)
  '.jw-icon-display', '.jw-display-icon-display', '.vjs-big-play-button', '.plyr__control--overlaid',
  "button[aria-label*='Play' i]", '.play-btn', '.btn-play', '#play', '.play',
];
export const CLICK_STEPS_ABYS = ['text:Mostrar Opções', 'text:Opção 1', ...STEPS_TAIL];   // embedplay.one → ABYS (3 qualidades)
export const CLICK_STEPS_BYSE = ['text:Mostrar Opções', 'text:Opção 2', ...STEPS_TAIL];   // embedplay.one → Byse (caminho da v4.54)
export const CLICK_STEPS = CLICK_STEPS_BYSE;   // padrão das demais fontes/fallback (compatível com os testes antigos)

// Script injetado no document-start em TODOS os frames (androidx.webkit, origins '*'): cada frame
// roda seu próprio loop clicando opção/gate/play e dando play mudo nos vídeos. Resolve o gate da
// Byse (`.captcha-gate__play` em f7hyg4q.org), que só existe DENTRO do iframe — o evaluateJavascript
// (frame principal) não alcançava e o frame-hop deixava a página em branco.
export function buildInjectScript(steps: string[] = CLICK_STEPS, extra = ''): string {
  const list = JSON.stringify(steps);
  return '(function(){try{if(window.__wmInj)return;window.__wmInj=1;try{console.log("WMINJ frame "+location.href.slice(0,70))}catch(_){}var STEPS=' + list + ';var done={};'
    + 'var vis=function(e){try{var r=e.getBoundingClientRect();return r.width>2&&r.height>2}catch(_){return false}};'
    + "var byText=function(t){t=t.toLowerCase();var all=document.querySelectorAll('button,a,div,span,li,label');for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>3)continue;var s=(e.textContent||'').trim().toLowerCase();if(s&&s.indexOf(t)>=0&&s.length<t.length+40&&vis(e))return e;}return null;};"
    + "var fire=function(e){try{['pointerdown','mousedown','pointerup','mouseup'].forEach(function(t){e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));});}catch(_){}try{e.click();}catch(_){}};"
    + 'var tick=function(){try{'
    + "document.querySelectorAll('video').forEach(function(v){try{v.muted=true;v.volume=0;if(v.paused){var p=v.play();if(p&&p.catch)p.catch(function(){});}}catch(_){}});"
    + 'for(var i=0;i<STEPS.length;i++){var st=STEPS[i];if(done[st])continue;var el=null;'
    + "if(st.indexOf('text:')===0){el=byText(st.slice(5));}else{var l=document.querySelectorAll(st);for(var j=0;j<l.length;j++){if(vis(l[j])){el=l[j];break;}}}"
    + 'if(el){done[st]=1;fire(el);try{console.log("WMINJ click "+st+" @ "+location.href.slice(0,55))}catch(_){}return;}}}catch(_){}};'
    + 'var n=0,iv=setInterval(function(){n++;tick();if(n>75)clearInterval(iv);},650);'
    + "if(document.readyState!=='loading')tick();else document.addEventListener('DOMContentLoaded',tick);"
    + '}catch(_){}})();' + extra;
}

// Pump do ABYS (15/09/2026), roda SÓ no frame abysscdn.com (mesmo document-start dos cliques): lê as
// qualidades do JW (`getPlaylistItem().sources`), mede o tamanho de cada MP4 virtual (Range 0-0 → o
// Service Worker responde content-range …/total), avisa o ProxyServer (/abyss/ready) e fica no loop
// /abyss/next → fetch(Range) no SW → POST /abyss/push. O leitor (ExoPlayer) manda: o JS só busca o que
// o proxy pede. Logs `WMABYS …` no console (logcat I/chromium) são o diagnóstico do emulador.
export function buildAbyssScript(sid: string, port = PROXY_PORT): string {
  return `(function(){try{
if(!/(^|\\.)abysscdn\\.com$/.test(location.hostname)||window.__wmAbys)return;window.__wmAbys=1;
var SID=${JSON.stringify(sid)},BASE='http://127.0.0.1:${port}/',lastKA=0;
var log=function(m){try{console.log('WMABYS '+m)}catch(_){}};
fetch(BASE+'abyss/progress?sid='+SID+'&stage=frame').then(function(r){log('frame '+location.hostname+' progress '+r.status)}).catch(function(e){log('progress-err '+e)});
var srcs=null,tries=0;
function readSources(){try{if(typeof jwplayer!=='function')return null;var p=jwplayer();var it=p.getPlaylistItem&&p.getPlaylistItem();var list=(it&&it.sources)||[];var out=[];
for(var i=0;i<list.length;i++){var s=list[i],f=String(s.file||'');if(!/^https?:/.test(f))continue;var m=/(\\d{3,4})p/.exec(String(s.label||''))||/\\/(\\d{3,4})p\\//.exec(f);if(m)out.push({q:+m[1],u:f});}
return out.length?out:null}catch(e){return null}}
/* Mede o MP4 virtual: Range de 1 KiB (NUNCA 'bytes=0-0' — o SW do Abyss trata fim 0 como aberto e devolve o
   arquivo inteiro, 1,4 GB; provado no emulador 15/09), lê SÓ o 1º pedaço do corpo e cancela o stream. */
function cancelBody(r){try{r.body&&r.body.cancel()}catch(_){}}
function firstChunk(r){var rd=r.body&&r.body.getReader?r.body.getReader():null;if(!rd)return r.arrayBuffer().then(function(b){return b.byteLength});return rd.read().then(function(c){try{rd.cancel()}catch(_){}return c.value?c.value.byteLength:0})}
function meta(s){return fetch(s.u,{headers:{Range:'bytes=0-1023'}}).then(function(r){var cr=r.headers.get('content-range')||'';var m=/\\/(\\d+)\\s*$/.exec(cr);s.total=m?+m[1]:(r.status==200?+(r.headers.get('content-length')||0):0);s.type=r.type;s.status=r.status;return firstChunk(r)}).then(function(n){s.ok=s.total>0&&n>0;log('meta q='+s.q+' status='+s.status+' total='+s.total+' type='+s.type+' first='+n+' ok='+s.ok);return s.ok}).catch(function(e){log('meta-err q='+s.q+' '+e);return false})}
function pump(){fetch(BASE+'abyss/next?sid='+SID).then(function(r){return r.json()}).then(function(n){
if(n&&n.gone){log('gone');return}
if(!n||n.off==null){var now=Date.now();if(now-lastKA>20000){lastKA=now;fetch(srcs[0].u,{headers:{Range:'bytes=0-1023'}}).then(cancelBody).catch(function(){})}return pump()}
var s=null;for(var i=0;i<srcs.length;i++)if(srcs[i].q==n.q)s=srcs[i];
if(!s){log('sem fonte q='+n.q);return setTimeout(pump,500)}
var t0=performance.now();
return fetch(s.u,{headers:{Range:'bytes='+n.off+'-'+(n.off+n.len-1)}}).then(function(r){return r.arrayBuffer()}).then(function(buf){
if(buf.byteLength>n.len)buf=buf.slice(0,n.len);   /* o SW pode devolver mais do que o pedido: corta no tamanho pedido */
if(!buf.byteLength){log('pump vazio q='+n.q+' off='+n.off);return setTimeout(pump,1000)}
var t1=performance.now();return fetch(BASE+'abyss/push?sid='+SID+'&q='+n.q+'&off='+n.off,{method:'POST',body:buf}).then(function(r){if(!r.ok)log('push '+r.status);var t2=performance.now();if(n.off%(16*1048576)<n.len)log('pump q='+n.q+' off='+n.off+' '+buf.byteLength+'B sw='+Math.round(t1-t0)+'ms push='+Math.round(t2-t1)+'ms');return pump()})})
}).catch(function(e){log('pump-err '+e);setTimeout(pump,1000)})}
var iv=setInterval(function(){tries++;var s=readSources();if(!s){if(tries>90){clearInterval(iv);log('sem sources')}return}
clearInterval(iv);srcs=s;log('sources '+s.map(function(x){return x.q}).join(','));
fetch(BASE+'abyss/progress?sid='+SID+'&stage=sources').catch(function(){});
Promise.all(s.map(meta)).then(function(){var ok=s.filter(function(x){return x.ok});if(!ok.length){log('sem meta');return}
srcs=ok;try{var p=jwplayer();p.pause&&p.pause();document.querySelectorAll('video').forEach(function(v){try{v.pause()}catch(_){}})}catch(_){}
return fetch(BASE+'abyss/ready?sid='+SID+'&list='+encodeURIComponent(JSON.stringify(ok.map(function(x){return{q:x.q,total:x.total}})))).then(function(r){log('ready '+r.status);pump()}).catch(function(e){log('ready-err '+e)})})},700);
}catch(e){try{console.log('WMABYS err '+e)}catch(_){}}})();`;
}

export function isHopHost(host: string | null | undefined, hops: string[] = HOP_HOSTS): boolean {
  const h = (host || '').toLowerCase();
  return !!h && hops.some(x => h === x || h.endsWith('.' + x));
}

// Script rodado no frame PRINCIPAL do WebView oculto a cada tick: muta/dá play nos <video> e
// clica o 1º passo ainda não clicado nesta página (1 clique por tick; cada seletor 1×).
export function buildClickScript(steps: string[] = CLICK_STEPS): string {
  const list = JSON.stringify(steps);
  return '(function(){try{var W=window;W.__wmDone=W.__wmDone||{};'
    + 'var vis=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0;};'
    + "var byText=function(t){t=t.toLowerCase();var all=document.querySelectorAll('button,a,div,span,li,label');"
    + "for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>3)continue;var s=(e.textContent||'').trim().toLowerCase();"
    + 'if(s&&s.indexOf(t)>=0&&s.length<t.length+40&&vis(e))return e;}return null;};'
    + "var fire=function(e){try{['pointerdown','mousedown','pointerup','mouseup'].forEach(function(t){e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:W}));});}catch(_){}try{e.click();}catch(_){}};"
    + "document.querySelectorAll('video').forEach(function(v){try{v.muted=true;v.volume=0;if(v.paused){var p=v.play();if(p&&p.catch)p.catch(function(){});}}catch(_){}});"
    + 'var steps=' + list + ';for(var i=0;i<steps.length;i++){var st=steps[i];if(W.__wmDone[st])continue;var el=null;'
    + "if(st.indexOf('text:')===0){el=byText(st.slice(5));}else{var l=document.querySelectorAll(st);for(var j=0;j<l.length;j++){if(vis(l[j])){el=l[j];break;}}}"
    + "if(el){W.__wmDone[st]=true;fire(el);return 'clicked:'+st;}}return 'none';}catch(e){return 'err:'+e;}})();";
}

// ── toggle (aba Servidores) ────────────────────────────────────────────────────
const KEY_ON = 'watchmov_resolver';            // '0' = desligado; ausente/'1' = ligado (padrão)
const KEY_FAILS = 'watchmov_resolver_fails';   // { [providerId]: { n, ts, v } }
const EVT = 'watchmov:resolver';
// 15/09/2026: 3 timeouts seguidos → 2 h de pausa NA FONTE (era 2 → 24 h). A v4.52 estourou 2× em
// cada fonte na noite de 14/09 e a pausa de 24 h sobreviveu às atualizações 4.53/4.54 que corrigiram
// a causa → o resolvedor sumiu sem aviso ("parece desativado"). Falha só conta na MESMA versão.
export const COOLDOWN_FAILS = 3;
export const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const APP_V = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function resolverEnabled(): boolean {
  try { return localStorage.getItem(KEY_ON) !== '0'; } catch { return true; }
}
export function setResolverEnabled(on: boolean): void {
  try { localStorage.setItem(KEY_ON, on ? '1' : '0'); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* ignore */ }
}
export function useResolverEnabled(): boolean {
  const [on, setOn] = useState(resolverEnabled);
  useEffect(() => {
    const fn = () => setOn(resolverEnabled());
    window.addEventListener(EVT, fn);
    return () => window.removeEventListener(EVT, fn);
  }, []);
  return on;
}

// ── pausa (cooldown) por fonte ─────────────────────────────────────────────────
type Fail = { n: number; ts: number; v?: string };
type Fails = Record<string, Fail>;
function readFails(): Fails { try { return JSON.parse(localStorage.getItem(KEY_FAILS) || '{}'); } catch { return {}; } }
function writeFails(f: Fails) { try { localStorage.setItem(KEY_FAILS, JSON.stringify(f)); } catch { /* ignore */ } }
// Falha de outra versão (ou sem versão = v4.52–4.54) NÃO vale: a atualização pode ter corrigido a causa.
const sameVersion = (f: Fail | undefined): f is Fail => !!f && (f.v ?? '') === APP_V;

export function resolverOnCooldown(providerId: string, now = Date.now()): boolean {
  const f = readFails()[providerId];
  return sameVersion(f) && f.n >= COOLDOWN_FAILS && now - f.ts < COOLDOWN_MS;
}
/** Quando a pausa da fonte termina (ms epoch); 0 = não está em pausa. */
export function resolverCooldownUntil(providerId: string, now = Date.now()): number {
  const f = readFails()[providerId];
  return resolverOnCooldown(providerId, now) && f ? f.ts + COOLDOWN_MS : 0;
}
export function noteResolverResult(providerId: string, ok: boolean, now = Date.now()): void {
  const all = readFails();
  if (ok) { delete all[providerId]; writeFails(all); return; }
  const cur = all[providerId];
  const n = sameVersion(cur) && now - cur.ts < COOLDOWN_MS ? cur.n + 1 : 1;   // falha velha ou de outra versão recomeça
  all[providerId] = { n, ts: now, v: APP_V };
  writeFails(all);
}
/** "Tentar agora": esquece as falhas da fonte (a pausa cai na hora). */
export function clearResolverCooldown(providerId: string): void {
  const all = readFails(); delete all[providerId]; writeFails(all);
}

// Por que o resolvedor NÃO vai rodar nesta abertura — pra mostrar na tela e gravar na aba Bugs.
// Antes ele calava e o servidor abria como se o recurso não existisse.
export type ResolverSkip = 'off' | 'cache' | 'server-mode' | 'cooldown' | 'tried' | null;
export function resolverSkipReason(o: { enabled: boolean; cacheOpen: boolean; armed: boolean; cooldown: boolean; tried: boolean }): ResolverSkip {
  if (!o.enabled) return 'off';
  if (o.cacheOpen) return 'cache';
  if (!o.armed) return 'server-mode';
  if (o.cooldown) return 'cooldown';
  if (o.tried) return 'tried';
  return null;
}

// ── plugin ─────────────────────────────────────────────────────────────────────
export async function startResolver(o: { url: string; referer?: string; providerId?: string; budgetMs?: number }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const abys = o.providerId === ABYS_PROVIDER;
  const sid = abys ? Math.random().toString(36).slice(2, 10) + Date.now().toString(36) : '';
  await Resolver.start({
    url: o.url, referer: o.referer, hopHosts: HOP_HOSTS, clickScript: buildClickScript(),
    injectScript: abys ? buildInjectScript(CLICK_STEPS_ABYS, buildAbyssScript(sid)) : buildInjectScript(),
    injectScriptAlt: abys ? buildInjectScript(CLICK_STEPS_BYSE) : '',
    abyssSid: sid, fallbackMs: abys ? ABYS_FALLBACK_MS : 0,
    budgetMs: o.budgetMs ?? budgetFor(o.providerId ?? ''),
  });
}
// keep = o vídeo está tocando pelo /abyss/ (página oculta = motor) → só para o relógio; o WebView fica.
export function stopResolver(keep = false): void {
  if (!Capacitor.isNativePlatform()) return;
  Resolver.stop({ keep }).catch(() => {});
}
export function onResolverEvent(cb: (e: ResolverEvent) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return Resolver.addListener('resolverEvent', cb);
}
