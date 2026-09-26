# Troca do link do espelhamento sem a TV recarregar — desenho

- Data: 25/09/2026 · base: `main` 4.71 (`84991ba`) · branch `feat/troca-link-sem-recarregar`
- Status: desenho aprovado pelo Weslley em 25/09/2026 ("1")

## 1. Pedido

- 25/09 20:50: *"nao tem um jeito de atualizar sem recarregar o video na tv? ex: o filme nao vai parar"*
- 25/09 21:30: *"primeiro a troca do link sem recarregar a TV"* (antes de qualquer outro ajuste)
- 25/09 21:40: *"para fonte 6 a opção 2 e para [fonte] 1 a opção 1"* → Fonte 6 troca **antes** de o link vencer; Fonte 1 troca **quando** o link morrer.

## 2. Como é hoje

- A TV recebe `http://<celular>:8099/s?u=<link>&r=<referer>&ap=pt` (`ProxyServer.lan`). Link novo = endereço novo →
  DLNA `Stop` + `SetAVTransportURI` + `Play` + `Seek` → a TV recarrega (para, mostra "Conectando", volta pra posição).
- O app troca o link em dois pontos, e os dois recarregam a TV:
  1. vigia do meio do filme (`PlayerActivity.midFilmTick` → `CastStall.Action.RELINK`): o player fecha pedindo link
     novo (`finishWithResult(..., recapture=true)`), o app busca de novo (`VideoPlayer.tsx` → `reResolve()`), reabre o
     player e ele manda o link novo pra TV (`CAST_LINK_NOVO` → `recastCurrent`);
  2. player reaberto com a fonte ABYS da TV já morta (`CAST_FONTE_TROCADA` → `recastCurrent`).
- **Fonte 6** (hclod): HLS `https://vid….hclod.qzz.io/st/_s3_/…/playlist.m3u8?md5=…&expires=…`, vence em **10 min**
  (`LinkExpiry.expiresAtMs`). O caminho (host + path) é o mesmo entre buscas; só `md5`/`expires` mudam.
- **Fonte 1** (ABYS): `http://127.0.0.1:8099/abyss/<sid>/<q>p.mp4`, servido pelo motor (página escondida do
  `ResolverPlugin`). Não tem prazo; só morre se o motor morrer ou parar. `AbyssSession.totals` guarda o tamanho de cada
  qualidade.
- **Defeito achado em 25/09 21:07** (e de novo 21:39): com a TV tocando ABYS, "Continuar" reabre o player e
  `PlayerActivity.prepare()` chama `player.prepare()` mesmo em silêncio (`castSilentStart`). O ExoPlayer abre um leitor
  na MESMA sessão ABYS, que é de um leitor só (`AbyssSession.want` → `gen++`) → `abyss: leitor substituído` → o fluxo da
  TV quebra → TV `STOPPED` 18 s depois → `RECAST_TV_PAROU` → recarga.

## 3. Decisões

1. **Só o mesmo arquivo troca por trás.** Fonte 6: mesmo host + path. Fonte 1: mesma qualidade e mesmo tamanho total.
   Arquivo diferente (outro servidor, outra qualidade, tamanho diferente) → continua como hoje (recarrega).
2. **Fonte 6: troca antes de vencer.** Busca escondida 3 min antes do `expires`; se falhar, tenta de novo a cada 60 s até
   vencer; trocou → agenda a próxima pelo prazo do link novo.
3. **Fonte 1: troca quando morre.** Motor morto (sessão encerrada) ou parado (2 "pedaço não chegou" em 2 min) → liga um
   motor novo, escondido, no mesmo título e qualidade.
4. **O endereço da TV nunca muda.** O proxy traduz o link que a TV pede para o link mais novo do mesmo arquivo.
5. **A TV espera em vez de falhar.** Com troca em andamento, o pedido da TV aguarda até 60 s pelo link novo.
6. **Com a TV tocando, o player do celular não puxa o vídeo.** Só o controle; o vídeo local carrega quando o
   espelhamento acaba, na posição da TV.
7. **Sem motor reserva** (dobraria a memória; o celular já chega no limite).

## 4. Desenho

### 4.1 Reabrir sem puxar a fonte da TV — `PlayerActivity`

- `prepare()`: com `castSilentStart`, põe o `MediaItem` mas **não** chama `player.prepare()`; marca `localPendente`.
- Quando o espelhamento acaba (`stopCasting` com `resumeLocal`): se `localPendente`, chama `player.prepare()`, vai pra
  posição da TV e toca.
- Pronto quando: reabrir o player com a TV tocando ABYS dá **0** `leitor substituído` no logcat nos 30 s seguintes e a
  TV segue tocando.

### 4.2 Troca por trás — `ProxyServer` + classe nova `LinkRenovado`

- `LinkRenovado` (lógica pura, testável em JUnit):
  - `registrar(urlNova)`: guarda `host+path → url mais nova`;
  - `atual(url)`: devolve o link mais novo do mesmo arquivo (ou o próprio `url`);
  - `registrarAbyss(sidVelho, sidNovo, q, total)` + `sucessorAbyss(url)`: `/abyss/<velho>/<q>p.mp4` →
    `/abyss/<novo>/<q>p.mp4` quando a qualidade e o tamanho batem.
- `/s` do proxy: antes de buscar, `u = LinkRenovado.atual(u)`; link `/abyss/` com sessão morta ou ausente → sucessor.
- HLS: ao registrar uma playlist nova, o proxy busca ela (e a variante) uma vez e registra cada segmento (`host+path →
  url nova`). Segmento sem token = nada muda.
- Espera: resposta 403/404/410 (ou sessão ABYS morta) num link que o `CastRenovacao` acompanha → o proxy avisa o
  `CastRenovacao` (que dispara a troca, se ainda não estiver em andamento), espera até 60 s o `LinkRenovado` mudar e
  tenta 1× com o link novo. Link que ninguém acompanha → erro como hoje.
- Aba Bugs: `CAST_LINK_TROCADO` (velho → novo, sem recarregar) e `CAST_TV_ESPEROU` (quanto a TV esperou).

### 4.3 Busca escondida — `ResolverPlugin` + `StreamSnifferPlugin` + classe nova `CastRenovacao`

- `ResolverPlugin.start` guarda os parâmetros da última busca por `key` (url, referer, hops, scripts, opção atual).
- `CastRenovacao` (estática, vive no processo, não depende de tela):
  - `acompanhar(key, link)` quando a TV aceita o link (1º envio e `RECAST_ACEITO`); `parar()` quando o espelhamento acaba;
  - link com `expires` (Fonte 6): agenda a busca para `expires − 3 min` (mínimo agora + 30 s);
  - link `/abyss/` (Fonte 1): escuta o sinal do proxy "fonte morta/parada".
- Busca = `ResolverPlugin.renovar(params)`: nova busca no WebView escondido, preso na tela visível (player ou app); o
  sniffer entrega o que achar para o `CastRenovacao` (não para o JS e sem o filtro de repetidos); vale o 1º link do
  mesmo arquivo (host + path na Fonte 6; `onAbyssReady` com a mesma qualidade e tamanho na Fonte 1) → registra no
  `LinkRenovado` (+ `ProxyServer.putHeaders`); limite 60 s; falhou → `CAST_LINK_RENOVAR_FALHOU` e nova tentativa.
- Rede de segurança: se a busca escondida não achar a tempo e o link morrer, o caminho de hoje (RELINK: o player fecha
  e o app busca) continua valendo, mas no fim, se o link novo for do mesmo arquivo, só registra a troca — sem recarregar.

## 5. Fora deste trabalho

- Motor reserva; troca entre fontes ou qualidades diferentes; app em 2º plano/tela desligada (não comprovado);
  Fontes 2 a 5.

## 6. Testes

- JUnit: `LinkRenovado` (mesmo host+path troca; path diferente não troca; sucessor ABYS com tamanho igual e diferente;
  segmentos HLS), agenda do `CastRenovacao` (`expires − 3 min`, mínimo 30 s, nova tentativa a cada 60 s).
- Vitest e tsc: sem regressão (160 testes; 11 erros de tsc = os da main).
- No celular dele com a TV (só quando ele liberar o aparelho):
  1. Fonte 1, "Continuar" com a TV tocando → 0 `leitor substituído`, TV segue.
  2. Fonte 1, motor derrubado de propósito (gancho de teste só no APK de teste) → a TV segue em até 60 s, sem
     `RECAST_ENVIADO`/`CAST_LINK_NOVO`, com `CAST_LINK_TROCADO` na aba Bugs.
  3. Fonte 6 espelhando mais de 12 min → `CAST_LINK_TROCADO` perto dos 7 min e a TV passa dos 10 min sem recarregar.

## 7. Entregas (um PR por vez)

1. Reabrir sem puxar a fonte da TV (4.1).
2. Troca por trás no proxy + caminho de hoje sem recarregar (4.2 e a rede de segurança de 4.3).
3. Busca escondida + agenda da Fonte 6 + gatilho da Fonte 1 (4.3).

Pronto quando: os 3 testes no aparelho passam, as suítes ficam verdes e ele dá o OK nos gates.
