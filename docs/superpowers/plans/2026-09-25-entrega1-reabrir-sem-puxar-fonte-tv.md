# Entrega 1 — reabrir o player sem puxar a fonte da TV — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** com a TV tocando uma fonte ABYS (Fonte 1), o player do celular não abre leitor na mesma sessão — nem ao reabrir ("Continuar") nem ao começar a espelhar de um player que já tocava — e o vídeo local só carrega quando o espelhamento acaba.

**Architecture:** a sessão ABYS do proxy é de um leitor só (`AbyssSession.want` → `gen++` derruba o anterior). Hoje o `PlayerActivity` chama `player.prepare()` mesmo em silêncio e, ao espelhar, só pausa o ExoPlayer (que continua enchendo o buffer) → os dois leitores brigam e a TV para. A regra "essa fonte não aguenta 2 leitores" e a duração do espelhamento viram funções puras em `CastLocal` (testáveis em JUnit); o `PlayerActivity` passa a deixar o player local parado (`stop()`/sem `prepare()`) enquanto espelha ABYS e guarda a duração que o local já sabia.

**Tech Stack:** Android (Java 17, Media3 ExoPlayer), JUnit 4 (`./gradlew testDebugUnitTest`).

Spec: `docs/superpowers/specs/2026-09-25-troca-link-sem-recarregar-tv-design.md` (seção 4.1).

---

## Arquivos

- Create: `android/app/src/main/java/com/weslley/watchmov/CastLocal.java` — regras puras: fonte de 1 leitor; duração do que está espelhado.
- Create: `android/app/src/test/java/com/weslley/watchmov/CastLocalTest.java`
- Modify: `android/app/src/main/java/com/weslley/watchmov/PlayerActivity.java` — `prepare()` (~964–992), `castDurMs()` (~880–886), `clearActiveCast()` (~1338), `startCasting()` (~1437–1450), `stopCasting()` (~1607–1636), campos estáticos (~1313–1316) e de instância (~1364).

### Task 1: `CastLocal` (regras puras) com testes

**Files:**
- Create: `android/app/src/main/java/com/weslley/watchmov/CastLocal.java`
- Test: `android/app/src/test/java/com/weslley/watchmov/CastLocalTest.java`

- [ ] **Step 1: escrever o teste que falha**

```java
package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 25/09/2026: com a TV tocando ABYS, o player do celular não pode abrir leitor na mesma sessão. */
public class CastLocalTest {
    @Test public void abysEhFonteDeUmLeitor() {
        assertTrue(CastLocal.umLeitor("http://127.0.0.1:8099/abyss/29v627c6muhlfem9/1080p.mp4"));
        assertTrue(CastLocal.umLeitor("http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/360p.mp4"));
    }

    @Test public void hlsMp4ENuloNaoSaoDeUmLeitor() {
        assertFalse(CastLocal.umLeitor("https://vid7102402.hclod.qzz.io/st/_s3_/v14/1032863/playlist.m3u8?md5=x&expires=1"));
        assertFalse(CastLocal.umLeitor("https://cdn.exemplo/v.mp4"));
        assertFalse(CastLocal.umLeitor(null));
    }

    @Test public void dlnaUsaLocalDepoisGuardadaDepoisTv() {
        assertEquals(6_724_000, CastLocal.duracao(true, 6_724_000, 1_000, 999, 0));   // local manda
        assertEquals(6_724_000, CastLocal.duracao(true, 0, 6_724_000, 999, 0));       // local parado → a que ele sabia
        assertEquals(999_000, CastLocal.duracao(true, 0, 0, 999_000, 0));              // ninguém sabe → TV
    }

    @Test public void chromecastConfiaNaTv() {
        assertEquals(5_000_000, CastLocal.duracao(false, 6_724_000, 6_724_000, 5_000_000, 0));
        assertEquals(6_724_000, CastLocal.duracao(false, 0, 6_724_000, 0, 0));
    }

    @Test public void nuncaMenorQueAPosicao() {
        assertEquals(7_000_000, CastLocal.duracao(true, 0, 0, 999_000, 7_000_000));
    }
}
```

- [ ] **Step 2: rodar e ver falhar**

Run: `cd android && ./gradlew testDebugUnitTest --tests com.weslley.watchmov.CastLocalTest --no-daemon -q`
Expected: FAIL (compilação: `cannot find symbol CastLocal`).

- [ ] **Step 3: implementação mínima**

```java
package com.weslley.watchmov;

/**
 * Espelhando, o que o player do CELULAR pode fazer (25/09/2026). A sessão ABYS do proxy é de UM leitor
 * (AbyssSession.want → gen++ derruba o anterior): o player local aberto na mesma fonte derrubava o leitor
 * da TV ("abyss: leitor substituído") e a TV parava → recarga. Puro, sem Android.
 */
final class CastLocal {
    private CastLocal() {}

    /** A fonte aguenta um leitor só (link do motor ABYS)? Então o player local fica parado enquanto espelha. */
    static boolean umLeitor(String url) { return LiveQuality.abyssSid(url) != null; }

    /**
     * Duração do que está na TV. DLNA: a do player local (a da TV às vezes vem errada — "Dia D" 05/09/2026);
     * com o local parado (fonte de 1 leitor), a que ele já sabia antes de parar; senão a da TV. Chromecast:
     * a da TV (RemoteMediaClient é confiável). Nunca menor que a posição.
     */
    static long duracao(boolean dlna, long local, long guardada, long tv, long pos) {
        long doCelular = local > 0 ? local : Math.max(0, guardada);
        long daTv = Math.max(0, tv);
        long dur = dlna ? (doCelular > 0 ? doCelular : daTv) : (daTv > 0 ? daTv : doCelular);
        return Math.max(dur, pos);
    }
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `cd android && ./gradlew testDebugUnitTest --tests com.weslley.watchmov.CastLocalTest --no-daemon -q`
Expected: PASS (5 testes).

- [ ] **Step 5: commit**

```bash
git add android/app/src/main/java/com/weslley/watchmov/CastLocal.java android/app/src/test/java/com/weslley/watchmov/CastLocalTest.java
git commit -m "feat(espelhamento): regras de quando o player do celular fica parado espelhando" # + trailer Co-Authored-By
```

### Task 2: `PlayerActivity` deixa o player local parado espelhando ABYS

**Files:**
- Modify: `android/app/src/main/java/com/weslley/watchmov/PlayerActivity.java`

- [ ] **Step 1: campos.** Junto de `private static String activeCastUrl;` (~1315):

```java
    private static long activeCastDurMs;      // duração que o player local sabia do título na TV (fica parado com ABYS)
```

Junto de `private boolean castSilentStart = false;` (~1364):

```java
    private boolean localPendente = false;    // player local com o vídeo posto mas sem prepare() (espelhando ABYS)
```

- [ ] **Step 2: `prepare()`** — trocar o fim (`player.setPlayWhenReady(!castSilentStart); if (castSilentStart) player.setVolume(0f); player.prepare();`) por:

```java
        player.setPlayWhenReady(!castSilentStart);
        if (castSilentStart) player.setVolume(0f);
        // TV tocando fonte de 1 leitor (ABYS): o prepare() mesmo em silêncio abria leitor na sessão da TV e derrubava
        // o dela (25/09/2026 21:07: "leitor substituído" → TV parada 18 s depois → recarga). Carrega ao parar de espelhar.
        if (castSilentStart && CastLocal.umLeitor(url)) localPendente = true;
        else { localPendente = false; player.prepare(); }
```

- [ ] **Step 3: `startCasting()`** — antes de `activeCastMode = mode; ... activeCastKey = resumeKey;` inserir:

```java
        if (activeCastKey == null || !activeCastKey.equals(resumeKey)) activeCastDurMs = 0;   // outro título na TV
```

e depois de `if (player != null) { player.pause(); player.setPlayWhenReady(false); player.setVolume(0f); }` inserir:

```java
        // Fonte de 1 leitor (ABYS): pausado, o ExoPlayer seguia enchendo o buffer na MESMA sessão da TV e derrubava o
        // leitor dela. Para de carregar (stop mantém item e posição) e guarda a duração que ele já sabia.
        if (player != null && !localPendente && CastLocal.umLeitor(currentUrl)) {
            long d = player.getDuration();
            if (d > 0) activeCastDurMs = d;
            player.stop();
            localPendente = true;
        }
```

- [ ] **Step 4: `castDurMs()`** — trocar o corpo por:

```java
    private long castDurMs() {
        boolean mesmaMidia = activeCastKey == null || activeCastKey.equals(resumeKey);
        long local = mesmaMidia && player != null && player.getDuration() > 0 ? player.getDuration() : 0;
        return CastLocal.duracao(castMode == CAST_DLNA, local, mesmaMidia ? activeCastDurMs : 0, lastRemoteDurMs, lastRemotePosMs);
    }
```

- [ ] **Step 5: fim do espelhamento.** Em `stopCasting()`, trocar `activeCastMode = CAST_NONE; ... activeCastUrl = null; // sessão encerrada` por (mesma linha + duração):

```java
        activeCastMode = CAST_NONE; activeDlnaCtrl = null; activeCastKey = null; activeCastTitle = null; activeCastUrl = null; activeCastDurMs = 0; // sessão encerrada
```

e trocar `if (resumeLocal && player != null) { if (tvPos > 0) player.seekTo(tvPos); player.setPlayWhenReady(true); }` por:

```java
        if (localPendente && player != null) { localPendente = false; if (tvPos > 0) player.seekTo(tvPos); player.prepare(); }
        if (resumeLocal && player != null) { if (tvPos > 0) player.seekTo(tvPos); player.setPlayWhenReady(true); }
```

Em `clearActiveCast()` acrescentar `activeCastDurMs = 0;`.

- [ ] **Step 6: compilar + JUnit + vitest + tsc**

Run: `cd android && ./gradlew testDebugUnitTest --no-daemon -q` → Expected: 0 falhas (6 suítes + `CastLocalTest`).
Run: `npx vitest run` → Expected: 160/160 (o `useWatchStore.test.ts` é instável também na main; repetir se falhar só ele).
Run: `npx tsc -p tsconfig.app.json --noEmit | grep -c "error TS"` → Expected: 11 (os mesmos da main).

- [ ] **Step 7: commit**

```bash
git add android/app/src/main/java/com/weslley/watchmov/PlayerActivity.java
git commit -m "fix(espelhamento): player do celular não puxa mais a fonte ABYS que a TV está tocando" # + trailer
```

### Task 3: APK de teste

- [ ] **Step 1:** copiar `~/.cache/wm_probe/espelhamento-2026-09-25/build_gate_espelhamento_e.sh` para `~/.cache/wm_probe/troca-link-2026-09-25/build_gate_entrega1.sh`, trocando a worktree para `feat+troca-link-sem-recarregar`, `versionCode` para **50298** e `versionName` para **4.71** (o próximo release do CI é o run ≥ 298 → nunca maior que ele) e o APK de saída para `~/.cache/wm_probe/WatchMov-v4.71-gate-50298a.apk`.
- [ ] **Step 2:** rodar → Expected: `FIM rc=0`, JUnit 0 falhas, `build.gradle` desfeito (`git status` limpo).

### Task 4: prova no celular dele com a TV (só com o OK dele — ele pode estar assistindo)

- [ ] **Step 1:** `adb -P 5038 -s 192.168.31.120:37077 install -r ~/.cache/wm_probe/WatchMov-v4.71-gate-50298a.apk` → `Success`.
- [ ] **Step 2:** título da Fonte 1 → Assistir → Espelhar → DLNA → `ATV_27` → TV tocando (print conferido).
- [ ] **Step 3:** voltar (fecha o player) → 30 s → "Continuar". Evidência: `adb logcat -d -v time --pid=$(pidof) | grep "leitor substituído"` **vazio** nos 30 s depois de reabrir; posição da TV andando (`dumpsys media_session`, 2 leituras com 20 s); aba Bugs sem `RECAST_TV_PAROU`/`RECAST_ENVIADO`; overlay com a duração certa do filme (print).
- [ ] **Step 4:** "Parar espelhamento" → o celular toca local na posição da TV (print).
- [ ] **Step 5:** registrar evidências no plano de retorno.

### Task 5: esteira pessoal

- [ ] check anti-sobrescrita isolado → push → PR → staging web (`~/.cache/wm_probe/stage_espelhamento.sh` com a worktree nova; símbolo conferido = nenhum JS novo → conferir só smoke PASS) → GATE 2 com o link + prints → merge squash → CI release → aba Bugs.
