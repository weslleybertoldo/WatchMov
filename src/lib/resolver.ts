// src/lib/resolver.ts
import { useEffect, useState } from 'react';
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

// Resolvedor OCULTO (pedido dele 14/09/2026: "quando clicar em assistir abra direto no
// reprodutor"). O nativo (ResolverPlugin.java) carrega a página da fonte num WebView invisível
// com o mesmo UA/cookies do app, faz frame-hop pros players em iframe de host conhecido e roda
// o clickScript abaixo a cada 1,5 s. O link capturado chega pelo MESMO streamFound do sniffer;
// quem abre o reprodutor é o auto-abrir do VideoPlayer. Aqui: wrapper do plugin, receita de
// cliques, toggle (padrão ligado) e pausa por fonte (3 timeouts seguidos na MESMA versão → 2 h).

export interface ResolverEvent { type: 'loaded' | 'hop' | 'click' | 'timeout'; url: string; hops?: number }
interface ResolverPlugin {
  start(o: { url: string; referer?: string; hopHosts: string[]; clickScript: string; injectScript: string; budgetMs: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'resolverEvent', cb: (e: ResolverEvent) => void): Promise<PluginListenerHandle>;
}
const Resolver = registerPlugin<ResolverPlugin>('Resolver');

// 30 s (era 15 s na v4.52): na prova viva de 14/09 a Fonte 6 (playerflix → Blogger → YouTube →
// googlevideo) levou ~27 s do hop até o link e a Fonte 1 (Byse) precisa de 2 hops + gate.
export const RESOLVER_BUDGET_MS = 45000;
// Iframes de player em que é preciso CLICAR (opção/gate) → o WebView oculto navega pra URL deles
// como frame principal (só o frame principal aceita evaluateJavascript). SuperFlix não precisa:
// o player em xn--…best toca sozinho dentro do iframe e a captura é por rede.
export const HOP_HOSTS = ['playerflix.ink', 'embedplay.one', 'f7hyg4q.org'];
// Ordem importa: 1 clique por tick e no máximo 1 por seletor por página. "text:" = por texto.
export const CLICK_STEPS = [
  'text:Mostrar Opções',                 // embedplay.one
  'text:Opção 2',                        // embedplay.one → Byse (opção 1/ABYS nunca entregou link no celular)
  '#optionList .option', '.option',      // playerflix (1ª = Blogger)
  '.captcha-gate__play',                 // f7hyg4q.org (Byse)
  '.jw-icon-display', '.jw-display-icon-display', '.vjs-big-play-button', '.plyr__control--overlaid',
  "button[aria-label*='Play' i]", '.play-btn', '.btn-play', '#play', '.play',
];

// Script injetado no document-start em TODOS os frames (androidx.webkit, origins '*'): cada frame
// roda seu próprio loop clicando opção/gate/play e dando play mudo nos vídeos. Resolve o gate da
// Byse (`.captcha-gate__play` em f7hyg4q.org), que só existe DENTRO do iframe — o evaluateJavascript
// (frame principal) não alcançava e o frame-hop deixava a página em branco.
export function buildInjectScript(steps: string[] = CLICK_STEPS): string {
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
    + '}catch(_){}})();';
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
export async function startResolver(o: { url: string; referer?: string; budgetMs?: number }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Resolver.start({ url: o.url, referer: o.referer, hopHosts: HOP_HOSTS, clickScript: buildClickScript(), injectScript: buildInjectScript(), budgetMs: o.budgetMs ?? RESOLVER_BUDGET_MS });
}
export function stopResolver(): void {
  if (!Capacitor.isNativePlatform()) return;
  Resolver.stop().catch(() => {});
}
export function onResolverEvent(cb: (e: ResolverEvent) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return Resolver.addListener('resolverEvent', cb);
}
