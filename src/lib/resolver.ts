// src/lib/resolver.ts
import { useEffect, useState } from 'react';
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

// Resolvedor OCULTO (pedido dele 14/09/2026: "quando clicar em assistir abra direto no
// reprodutor"). O nativo (ResolverPlugin.java) carrega a página da fonte num WebView invisível
// com o mesmo UA/cookies do app, faz frame-hop pros players em iframe de host conhecido e roda
// o clickScript abaixo a cada 1,5 s. O link capturado chega pelo MESMO streamFound do sniffer;
// quem abre o reprodutor é o auto-abrir do VideoPlayer. Aqui: wrapper do plugin, receita de
// cliques, toggle (padrão ligado) e pausa por fonte (3 timeouts seguidos na MESMA versão → 2 h).

export interface ResolverEvent { type: 'loaded' | 'hop' | 'click' | 'timeout' | 'abyss' | 'option'; url: string; hops?: number; k?: number; n?: number; name?: string; names?: string[] }
interface ResolverPlugin {
  start(o: { url: string; referer?: string; hopHosts: string[]; clickScript: string; injectScript: string; injectScriptAlt?: string; abyssSid?: string; fallbackMs?: number; optMs?: number; startOpt?: number; budgetMs: number }): Promise<void>;
  stop(o?: { keep?: boolean }): Promise<void>;
  pickOption(o: { k: number }): Promise<void>;
  addListener(event: 'resolverEvent', cb: (e: ResolverEvent) => void): Promise<PluginListenerHandle>;
}
const Resolver = registerPlugin<ResolverPlugin>('Resolver');

// Orçamento por fonte (15/09/2026): Fonte 1 = ABYS (~10–30 s até o proxy dizer "ready") + fallback Byse
// aos 30 s sem sinal do frame abysscdn (ou aos 60 s se o pump já leu as `sources` — /abyss/progress) →
// 90 s; demais fontes seguem 45 s (Fonte 6 playerflix→Blogger leva ~24–27 s).
export const RESOLVER_BUDGET_MS = 45000;
export const RESOLVER_BUDGET_ABYS_MS = 90000;
export const ABYS_FALLBACK_MS = 30000;
export const RESOLVER_OPT_MS = 30000;   // v4.57: tempo por opcao (Fonte 6 playerflix: Blogger->VIP Player->...) antes de tentar a proxima
export const PROXY_PORT = 8099;   // ProxyServer.PORT
export const ABYS_PROVIDER = 'embedplayapi';   // Fonte 1: "Mostrar Opções" → Opção 1 (ABYS) / Opção 2 (BYSE)
// Fontes cujo servidor principal é o player Abyss (motor /abyss/ + pump): a Fonte 5 (FS/HD) abre o Abyss em
// abyssplayer.com depois de "Dublado" + servidor (25/09/2026) — antes ficava 45 s "procurando" sem clicar nada.
export const ABYS_PROVIDERS = [ABYS_PROVIDER, 'fshd'];
export const usesAbys = (providerId?: string) => !!providerId && ABYS_PROVIDERS.includes(providerId);
export function budgetFor(providerId: string): number { return usesAbys(providerId) ? RESOLVER_BUDGET_ABYS_MS : RESOLVER_BUDGET_MS; }
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
// v4.64: Fonte 1 no ciclo de opções — só revela a lista ('Mostrar Opções'); a opção K vem da lista REAL (.player_select_item)
export const CLICK_STEPS_F1 = ['text:Mostrar Opções', ...STEPS_TAIL];

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

// v4.57: injeção com CICLO de opções pro playerflix (Fonte 6). Em todo frame: se houver
// `#optionList .option` (a lista Blogger / VIP Player / Premium / …), reporta os nomes por console
// (`WMOPT|n=…|names=a»b`) e clica a K-ésima opção (K = __OPT_K__, o nativo troca a cada tentativa).
// Sem lista de opções, cai no clicador genérico (gate/play). O ResolverPlugin lê o console,
// cronometra cada opção e recarrega com o próximo K se falhar; só cai no picker manual quando TODAS falham.
// v4.62 (provado por CDP no emulador 15/09): o playerflix ESCONDE (`display:none`) as opções de outros
// idiomas — filtrar por visibilidade fazia o ciclo enxergar 1 de 3 opções (Black Torch: só "Blogger pt-br",
// nunca chegava no "Blogger en-us" nem no "Premium"). Agora enumera TODAS as `.option` (o `onclick=player(this)`
// funciona mesmo escondida) e desempata nomes repetidos com o `data-audio`. Opção cujo `data-embed` é
// `superflixapi.` = Cloudflare Turnstile (server-only, não extraível no WebView oculto) → avisa
// `WMOPT|skip` e o nativo pula na hora em vez de queimar 30 s nela.
// v4.63 (pedido dele 15/09 23:40, "não é pra extrair a legendada, só a dublada"): a 1ª opção do DOM é a
// LEGENDADA (`data-audio="en-us"`) e passou a abrir primeiro. Só entram no ciclo as opções DUBLADAS
// (`data-audio` começando com `pt`) ou sem `data-audio`; as demais são contadas em `WMOPT|filtered`
// (→ `RESOLVER_OPTION_FILTER` na aba Bugs). Título só legendado = sem opção = cai em "troque de fonte".
// v4.64 (pedido dele 16/09 00:0x, "por que apareceram 2 opções se só tinha 1"): a Fonte 1 (embedplay.one) entra no MESMO
// ciclo — a lista vem dos `.player_select_item` do grupo do áudio "Dublado" (`.players_select_items[data-target]`),
// nome curto = o que está entre parênteses ("Opção 1 (ABYS)" → ABYS). Acaba a lista fixa ABYS/Byse do nativo:
// título com só "Opção 1 (ABYS)" mostra 1 opção; UPNS/BYSE só aparecem quando existem. O pump do ABYS continua
// concatenado (roda só no frame abysscdn) e o Byse continua pelo clicador genérico (`.captcha-gate__play`).
export function buildOptionCycleScript(steps: string[] = CLICK_STEPS): string {
  const list = JSON.stringify(steps);
  return '(function(){try{if(window.__wmInj)return;window.__wmInj=1;var K=__OPT_K__;var STEPS=' + list + ';var done={};var reported=false;'
    + 'var vis=function(e){try{var r=e.getBoundingClientRect();return r.width>2&&r.height>2}catch(_){return false}};'
    + "var norm=function(t){var ls=(t||'').split(String.fromCharCode(10));for(var i=0;i<ls.length;i++){var L=ls[i].split('|').join(' ').split('»').join(' ').trim();if(L)return L.slice(0,40);}return '';};"
    + "var byText=function(t){t=t.toLowerCase();var all=document.querySelectorAll('button,a,div,span,li,label');for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length>3)continue;var s=(e.textContent||'').trim().toLowerCase();if(s&&s.indexOf(t)>=0&&s.length<t.length+40&&vis(e))return e;}return null;};"
    + "var fire=function(e){try{['pointerdown','mousedown','pointerup','mouseup'].forEach(function(t){e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));});}catch(_){}try{e.click();}catch(_){}};"
    + "var names=function(os){var nm=[];for(var i=0;i<os.length;i++)nm.push(norm(os[i].textContent));"
    + "for(var i=0;i<os.length;i++){var c=0;for(var j=0;j<nm.length;j++){if(nm[j]===nm[i])c++;}"
    + "if(c>1){var a=os[i].getAttribute('data-audio');if(a)nm[i]=(nm[i]+' '+a).slice(0,40);}}return nm;};"
    // (A) playerflix (Fonte 6): #optionList .option, so as DUBLADAS (data-audio pt) — v4.63
    + "var findPF=function(){var ol=document.querySelectorAll('#optionList .option');if(!ol.length)return null;var os=[],out=0;for(var oi=0;oi<ol.length;oi++){var au=(ol[oi].getAttribute('data-audio')||'').toLowerCase();if(!au||au.indexOf('pt')===0)os.push(ol[oi]);else out++;}return {os:os,out:out,kind:'pf'};};"
    // (B) embedplay.one (Fonte 1, v4.64): grupo .players_select_items[data-target] do audio "Dublado" (.select_language); itens .player_select_item
    + "var findEP=function(){var langs=document.querySelectorAll('.select_language'),all=document.querySelectorAll('.player_select_item');if(!langs.length&&!all.length)return null;"
    + "var dub=null;for(var li=0;li<langs.length;li++){if((langs[li].textContent||'').toLowerCase().indexOf('dublado')>=0)dub=langs[li];}var tg=dub?dub.getAttribute('data-target'):null;"
    + "var os=[],out=0;for(var ai=0;ai<all.length;ai++){var g=all[ai].closest?all[ai].closest('.players_select_items'):null;var gt=g?g.getAttribute('data-target'):null;if(tg===null||gt===null||gt===tg)os.push(all[ai]);else out++;}"
    + "if(dub&&String(dub.className).indexOf('active')<0&&!done['__dub__']){done['__dub__']=1;fire(dub);}return {os:os,out:out,kind:'ep'};};"
    // (C) FS/HD (Fonte 5, 25/09/2026): áudio em .audio-selector (Legendado/Dublado) e servidores em .server-selector
    // (Abyss/Streamwish). Escolhe "Dublado" 1× e cicla os servidores visíveis; sem Dublado = só legendado → filtrado.
    + "var findFS=function(){var aud=document.querySelectorAll('.audio-selector'),srv=document.querySelectorAll('.server-selector');if(!aud.length&&!srv.length)return null;"
    + "var dub=null;for(var i=0;i<aud.length;i++){if((aud[i].textContent||'').toLowerCase().indexOf('dublado')>=0)dub=aud[i];}"
    + "if(!dub)return {os:[],out:srv.length||1,kind:'fs'};"
    + "if(String(dub.className).indexOf('active')<0){if(!done['__fsdub__']){done['__fsdub__']=1;fire(dub);}return {os:[],out:0,kind:'fs'};}"
    + "var os=[];for(var j=0;j<srv.length;j++){var g=srv[j].closest?srv[j].closest('.player-options-servers'):null;if(!g||String(g.className).indexOf('hidden')<0)os.push(srv[j]);}return {os:os,out:0,kind:'fs'};};"
    // nome curto da opcao da embedplay.one: "Opção 1 (ABYS)" → "ABYS"
    + "var epName=function(o){var n=o.querySelector('.player_select_name');var t=norm((n||o).textContent);var a=t.indexOf('('),b=t.indexOf(')');return (a>=0&&b>a)?t.slice(a+1,b).slice(0,40):t;};"
    + 'var tick=function(){try{'
    + "document.querySelectorAll('video').forEach(function(v){try{v.muted=true;v.volume=0;if(v.paused){var p=v.play();if(p&&p.catch)p.catch(function(){});}}catch(_){}});"
    + "var f=findPF()||findEP()||findFS();var os=f?f.os:[],out=f?f.out:0;"
    // embedplay.one esconde a lista atras de "Mostrar Opções" (.changeOptions) — revela uma vez
    + "if(f&&f.kind==='ep'){var co=document.querySelector('.changeOptions');if(co&&!done['__show__']&&vis(co)&&String(co.className).indexOf('hidden')<0){done['__show__']=1;fire(co);}}"
    + "if(f&&!os.length&&out&&!reported){reported=true;try{console.log('WMOPT|filtered|nao-dublado='+out+'|restou=0')}catch(_){}}"
    + "if(os.length){var nm=f.kind==='ep'?os.map(epName):names(os);if(!reported){reported=true;try{console.log('WMOPT|n='+os.length+'|names='+nm.join('»'));if(out)console.log('WMOPT|filtered|nao-dublado='+out+'|restou='+os.length)}catch(_){}}"
    + "var ki=K-1;if(ki<0)ki=0;if(ki>=os.length)ki=os.length-1;"
    + "if(!done['__opt__']){done['__opt__']=1;var emb=os[ki].getAttribute('data-embed')||'';"
    + "if(emb.indexOf('superflixapi.')>=0){try{console.log('WMOPT|skip|k='+K+'|name='+nm[ki]+'|reason=turnstile')}catch(_){}return;}"
    + "try{console.log('WMOPT|click|k='+K+'|name='+nm[ki])}catch(_){}fire(os[ki]);}return;}"
    + 'for(var i=0;i<STEPS.length;i++){var st=STEPS[i];if(done[st])continue;var el=null;'
    + "if(st.indexOf('text:')===0){el=byText(st.slice(5));}else{var l=document.querySelectorAll(st);for(var j=0;j<l.length;j++){if(vis(l[j])){el=l[j];break;}}}"
    + 'if(el){done[st]=1;fire(el);return;}}}catch(_){}};'
    + 'var n=0,iv=setInterval(function(){n++;tick();if(n>140)clearInterval(iv);},650);'
    + "if(document.readyState!=='loading')tick();else document.addEventListener('DOMContentLoaded',tick);"
    + '}catch(_){}})();';
}

// Pump do ABYS (15/09/2026), roda SÓ no frame abysscdn.com (mesmo document-start dos cliques): lê as
// qualidades do JW (`getPlaylistItem().sources`), mede o tamanho de cada MP4 virtual (Range 0-0 → o
// Service Worker responde content-range …/total), avisa o ProxyServer (/abyss/ready) e fica no loop
// /abyss/next → fetch(Range) no SW → POST /abyss/push. O leitor (ExoPlayer) manda: o JS só busca o que
// o proxy pede. Logs `WMABYS …` no console (logcat I/chromium) são o diagnóstico do emulador.
// Laços do pump em paralelo (24/09/2026): o proxy marca cada pedaço como "em voo" e não repete. Com 1 laço só,
// o 1080p engasgava — cada busca de 2 MiB no SW do Abyss tinha que sair em < 5 s pra acompanhar ~3,3 Mbps.
export const ABYSS_PUMPS = 3;
export function buildAbyssScript(sid: string, port = PROXY_PORT): string {
  return `(function(){try{
if(!/(^|\\.)(abysscdn|abyssplayer)\\.com$/.test(location.hostname)||window.__wmAbys)return;window.__wmAbys=1;
var SID=${JSON.stringify(sid)},BASE='http://127.0.0.1:${port}/',lastKA=0,PUMPS=${ABYSS_PUMPS};
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
return fetch(BASE+'abyss/ready?sid='+SID+'&list='+encodeURIComponent(JSON.stringify(ok.map(function(x){return{q:x.q,total:x.total}})))).then(function(r){log('ready '+r.status);for(var w=0;w<PUMPS;w++)pump()}).catch(function(e){log('ready-err '+e)})})},700);
}catch(e){try{console.log('WMABYS err '+e)}catch(_){}}})();`;
}

// v4.58: leitor do Blogger/YouTube — captura o link direto da CONFIG do player, sem depender do
// vídeo "tocar" no WebView oculto. Roda em todo frame (guardado por __wmBlog).
// v4.62 (causa raiz achada por CDP no emulador 15/09): no frame `blogger.com` NÃO existem
// `VIDEO_CONFIG`/`ytInitialPlayerResponse` (a página nova, boq-blogger.BloggerVideoPlayerUi, é um
// `c-wiz` que só mostra a thumbnail); quem tem as URLs é o **XHR `/_/BloggerVideoPlayerUi/data/batchexecute`**
// (resposta com googlevideo itag 18 E 22) e o player do YouTube só é montado DEPOIS de um clique no
// `<main jsaction="click:…">`. Por isso o resolvedor oculto dava `v=0` sem nenhum `WMBLOG`. Agora:
//  1. hook em XHR/fetch → varre a resposta atrás de `googlevideo.com/videoplayback` (não espera tocar);
//  2. clica o player do Blogger → o iframe do YouTube carrega e o leitor de config também funciona;
//  3. mantém o leitor `VIDEO_CONFIG`/`ytInitialPlayerResponse`/`currentSrc` (frame do YouTube).
// Emite `WMBLOG|q=<qualidade>|url=<u>` (maior qualidade primeiro); `WMBLOG|url=` continua aceito = 360p.
export function buildBloggerScript(): string {
  return '(function(){try{if(window.__wmBlog)return;window.__wmBlog=1;'
    + "var log=function(m){try{console.log('WMBLOG|'+m)}catch(_){}};var done=false;var sent={};"
    + "var B=String.fromCharCode(92);var STOP=String.fromCharCode(34,92,32,44,93,125,10,13,9);"
    + "var QMAP={18:'360p',22:'720p',37:'1080p',59:'480p',43:'360p'};"
    + "var emit=function(u,q){if(!u||u.indexOf('http')!==0)return false;var k=u.slice(0,150);if(sent[k])return false;sent[k]=1;log('q='+(q||'360p')+'|url='+u);return true;};"
    // lista {u,q} -> emite da MAIOR qualidade pra menor (o auto-abrir do app pega o 1o link)
    + "var flush=function(list){if(!list.length)return false;list.sort(function(a,b){return parseInt(b.q,10)-parseInt(a.q,10)});var any=false;"
    + "for(var i=0;i<list.length;i++){if(emit(list[i].u,list[i].q))any=true;}if(any)done=true;return any;};"
    + "var unesc=function(t){return t.split(B+'u0026').join('&').split(B+'u003d').join('=').split(B+'/').join('/');};"
    + "var itagOf=function(u){var i=u.indexOf('itag=');if(i<0)return 0;var n=parseInt(u.slice(i+5),10);return isNaN(n)?0:n;};"
    // (1) hook de XHR/fetch: a pagina nova do Blogger busca as URLs num POST /BloggerVideoPlayerUi/data/batchexecute
    + "var scan=function(txt){try{if(!txt||typeof txt!=='string'||txt.indexOf('googlevideo')<0)return;var t=unesc(txt);var list=[],i=0;"
    + "while((i=t.indexOf('https://',i))>=0){var j=i;while(j<t.length&&STOP.indexOf(t.charAt(j))<0)j++;var u=t.slice(i,j);i=j+1;"
    + "if(u.indexOf('googlevideo.com/videoplayback')<0)continue;if(u.indexOf('source=youtube')>=0)continue;var it=itagOf(u);if(!QMAP[it])continue;"
    + "list.push({u:u,q:QMAP[it]});}flush(list);}catch(_){}};"
    + "var body=function(x){var t=null;try{t=x.responseText}catch(_){}if(!t){try{var r=x.response;if(typeof r==='string')t=r;}catch(_){}}return t;};"
    + "try{var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;"
    + "XMLHttpRequest.prototype.open=function(){try{this.__wmU=arguments[1]}catch(_){}return XO.apply(this,arguments)};"
    + "XMLHttpRequest.prototype.send=function(){var x=this;try{var grab=function(){try{if(x.readyState===4)scan(body(x))}catch(_){}};"
    + "x.addEventListener('load',grab);x.addEventListener('readystatechange',grab);}catch(_){}return XS.apply(this,arguments)};}catch(_){}"
    + "try{var OF=window.fetch;if(OF)window.fetch=function(){var r=OF.apply(this,arguments);try{r.then(function(res){try{res.clone().text().then(scan).catch(function(){})}catch(_){}}).catch(function(){})}catch(_){}return r};}catch(_){}"
    // (2) o player do Blogger so monta o iframe do YouTube DEPOIS de um clique no <main jsaction=...>
    + "var fire=function(e){try{['pointerdown','mousedown','pointerup','mouseup'].forEach(function(t){e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));});}catch(_){}try{e.click();}catch(_){}};"
    + "var clicks=0;var wake=function(){try{if(location.hostname.indexOf('blogger.com')<0)return;"
    + "if(document.querySelector('iframe[src*=\"youtube\"]'))return;if(clicks>=6)return;clicks++;"
    + "var m=document.querySelector('main[jsaction],[jsname=kpuEBe],.iLXc1d')||document.body;if(m)fire(m);}catch(_){}};"
    // (3) leitor da config do player (frame do YouTube / Blogger antigo): TODAS as qualidades com URL direta
    + 'var pick=function(){if(done)return;try{var list=[];'
    + 'var vc=window.VIDEO_CONFIG;'
    + "if(vc&&vc.streams){for(var i=0;i<vc.streams.length;i++){var st=vc.streams[i];if(st&&st.play_url)list.push({u:st.play_url,q:QMAP[st.format_id]||'360p'});}}"
    + 'var pr=window.ytInitialPlayerResponse;var f=pr&&pr.streamingData&&pr.streamingData.formats;'
    + "if(f){for(var j=0;j<f.length;j++){if(f[j]&&f[j].url)list.push({u:f[j].url,q:QMAP[f[j].itag]||(f[j].qualityLabel||'360p')});}}"
    + "if(!list.length){var v=document.querySelector('video');var sc=v&&(v.currentSrc||v.src);if(sc&&sc.indexOf('googlevideo')>=0)list.push({u:sc,q:QMAP[itagOf(sc)]||'360p'});}"
    + 'flush(list);'
    + '}catch(_){}};'
    + 'var n=0,iv=setInterval(function(){n++;wake();pick();if(n>60)clearInterval(iv);},700);wake();pick();'
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
export type ResolverSkip = 'off' | 'cache' | 'server-mode' | 'cooldown' | 'tried' | 'unavailable' | null;
export function resolverSkipReason(o: { enabled: boolean; cacheOpen: boolean; armed: boolean; cooldown: boolean; tried: boolean }): ResolverSkip {
  if (!o.enabled) return 'off';
  if (o.cacheOpen) return 'cache';
  if (!o.armed) return 'server-mode';
  if (o.cooldown) return 'cooldown';
  if (o.tried) return 'tried';
  return null;
}

// ── plugin ─────────────────────────────────────────────────────────────────────
export async function startResolver(o: { url: string; referer?: string; providerId?: string; startOpt?: number; budgetMs?: number }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const abys = usesAbys(o.providerId);
  const sid = abys ? Math.random().toString(36).slice(2, 10) + Date.now().toString(36) : '';
  await Resolver.start({
    url: o.url, referer: o.referer, hopHosts: HOP_HOSTS, clickScript: buildClickScript(),
    // v4.64: Fonte 1 também roda o ciclo de opções (lista REAL da embedplay.one) + o pump do ABYS; o antigo par
    // "script principal Opção 1 / alternativo Opção 2" (fallbackMs) saiu — quem avança agora é o cronômetro por opção.
    injectScript: abys ? buildOptionCycleScript(o.providerId === ABYS_PROVIDER ? CLICK_STEPS_F1 : CLICK_STEPS) + buildAbyssScript(sid) : buildOptionCycleScript() + buildBloggerScript(),
    injectScriptAlt: '',
    abyssSid: sid, fallbackMs: 0,
    optMs: RESOLVER_OPT_MS,
    startOpt: o.startOpt ?? 1,
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
// v4.61: força uma opção (tap na lista da tela "Procurando") — o nativo reinjeta/recarrega naquele k.
export function pickResolverOption(k: number): void {
  if (!Capacitor.isNativePlatform()) return;
  Resolver.pickOption({ k }).catch(() => {});
}
