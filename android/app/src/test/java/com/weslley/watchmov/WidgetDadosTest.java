package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Widget "Controle da TV" (07/11/2026): teclas, corpos da edge function tv-remote, lista de TVs, erros e fila. */
public class WidgetDadosTest {

    // Resposta da edge function tv-remote (action "tvs").
    private static final String RESPOSTA = "{\"devices\":["
        + "{\"session_id\":\"a1\",\"name\":\"TV da sala\",\"model\":\"AFTSSS\",\"last_seen_at\":\"2026-11-07T12:00:00Z\"},"
        + "{\"session_id\":\"b2\",\"name\":\"Quarto\",\"model\":null,\"last_seen_at\":null}]}";

    @Test public void soAsTrezeTeclasDoControleValem() {
        String[] validas = { "up", "down", "left", "right", "ok", "back", "home", "rew", "ff", "playpause", "prev-ep",
            "next-ep", "watched" };
        assertEquals(13, validas.length);
        for (String t : validas) assertTrue(t, WidgetDados.teclaValida(t));
        // "Segurar o OK" não existe no widget (só toque); maiúscula, espaço e vazio também não passam.
        for (String t : new String[] { "ok-hold", "", " ok", "ok ", "OK", "Up", "ping", "x" })
            assertFalse(t, WidgetDados.teclaValida(t));
        assertFalse(WidgetDados.teclaValida(null));
    }

    @Test public void corposNoFormatoDaEdgeFunction() throws Exception {
        JSONObject k = new JSONObject(WidgetDados.corpoTecla("to\"k/en", "sid-1", "prev-ep"));
        assertEquals("key", k.getString("action"));
        assertEquals("to\"k/en", k.getString("token"));   // aspas e barra no token não quebram o JSON
        assertEquals("sid-1", k.getString("to"));
        assertEquals("prev-ep", k.getString("key"));
        assertEquals(4, k.length());

        JSONObject t = new JSONObject(WidgetDados.corpoTvs("tok"));
        assertEquals("tvs", t.getString("action"));
        assertEquals("tok", t.getString("token"));
        assertEquals(2, t.length());
    }

    @Test public void enderecoDaEdgeFunction() {
        assertEquals("https://x.supabase.co/functions/v1/tv-remote", WidgetDados.endereco("https://x.supabase.co"));
        assertEquals("https://x.supabase.co/functions/v1/tv-remote", WidgetDados.endereco(" https://x.supabase.co// "));
    }

    @Test public void leAListaSalvaEARespostaDoServidor() {
        List<WidgetDados.Tv> salva = WidgetDados.lerTvs(
            "[{\"session_id\":\"a1\",\"name\":\"TV da sala\"},{\"session_id\":\"b2\",\"name\":\"Quarto\"}]");
        assertEquals(2, salva.size());
        assertEquals("a1", salva.get(0).sessionId);
        assertEquals("TV da sala", salva.get(0).nome);
        assertEquals("Quarto", salva.get(1).nome);

        List<WidgetDados.Tv> servidor = WidgetDados.lerTvs(RESPOSTA);   // model/last_seen_at são ignorados
        assertEquals(2, servidor.size());
        assertEquals("b2", servidor.get(1).sessionId);
        assertEquals("Quarto", servidor.get(1).nome);
        assertTrue(WidgetDados.temListaDeTvs(RESPOSTA));
        assertTrue(WidgetDados.temListaDeTvs("{\"devices\":[]}"));      // conta sem TV: lista vazia de verdade
        assertTrue(WidgetDados.lerTvs("{\"devices\":[]}").isEmpty());
    }

    @Test public void tvSemSessaoFicaDeForaESemNomeViraTv() {
        List<WidgetDados.Tv> tvs = WidgetDados.lerTvs("[{\"name\":\"sem sessão\"},{\"session_id\":\"\",\"name\":\"vazia\"},"
            + "{\"session_id\":null,\"name\":\"nula\"},{\"session_id\":\"c3\",\"name\":\"  \"},{\"session_id\":\"d4\"},"
            + "{\"session_id\":\"e5\",\"name\":null},\"texto\",7,null,{\"session_id\":\" f6 \",\"name\":\" Sala \"}]");
        assertEquals(4, tvs.size());
        assertEquals("c3", tvs.get(0).sessionId);
        assertEquals("TV", tvs.get(0).nome);   // nome em branco
        assertEquals("d4", tvs.get(1).sessionId);
        assertEquals("TV", tvs.get(1).nome);   // sem nome
        assertEquals("TV", tvs.get(2).nome);   // null no JSON (o optString do Android leria "null")
        assertEquals("f6", tvs.get(3).sessionId);
        assertEquals("Sala", tvs.get(3).nome);
        assertNull(WidgetDados.tvDe(null));
    }

    @Test public void jsonQuebradoViraListaVazia() {
        for (String s : new String[] { null, "", "  ", "{", "[{\"session_id\":\"a\"", "lixo", "42",
            "{\"error\":{\"code\":\"bad_token\"}}", "{\"devices\":\"x\"}" })
            assertTrue(String.valueOf(s), WidgetDados.lerTvs(s).isEmpty());
        // ...e não conta como resposta da lista: um 200 estranho não apaga a lista salva nem a TV escolhida.
        for (String s : new String[] { null, "", "{", "lixo", "[]", "<html>502</html>",
            "{\"error\":{\"code\":\"bad_token\"}}", "{\"devices\":null}" })
            assertFalse(String.valueOf(s), WidgetDados.temListaDeTvs(s));
    }

    @Test public void listaVaiEVoltaPeloJsonSalvo() {
        List<WidgetDados.Tv> tvs = Arrays.asList(new WidgetDados.Tv("a1", "TV da sala"),
            new WidgetDados.Tv("b2", "Quarto \"2\" — ção"));
        List<WidgetDados.Tv> volta = WidgetDados.lerTvs(WidgetDados.tvsParaJson(tvs));
        assertEquals(2, volta.size());
        assertEquals("a1", volta.get(0).sessionId);   // mesma ordem
        assertEquals("TV da sala", volta.get(0).nome);
        assertEquals("b2", volta.get(1).sessionId);
        assertEquals("Quarto \"2\" — ção", volta.get(1).nome);
        assertEquals("[]", WidgetDados.tvsParaJson(null));
        assertEquals("[]", WidgetDados.tvsParaJson(new ArrayList<>()));
        // TV sem sessão nem entra no salvo.
        List<WidgetDados.Tv> tortas = Arrays.asList(new WidgetDados.Tv(null, "x"), null, new WidgetDados.Tv("", "y"),
            new WidgetDados.Tv("c3", "z"));
        List<WidgetDados.Tv> limpas = WidgetDados.lerTvs(WidgetDados.tvsParaJson(tortas));
        assertEquals(1, limpas.size());
        assertEquals("c3", limpas.get(0).sessionId);
    }

    @Test public void contemATvEscolhida() {
        List<WidgetDados.Tv> tvs = WidgetDados.lerTvs(RESPOSTA);
        assertTrue(WidgetDados.contem(tvs, "a1"));
        assertTrue(WidgetDados.contem(tvs, "b2"));
        assertFalse(WidgetDados.contem(tvs, "zz"));
        assertFalse(WidgetDados.contem(tvs, ""));
        assertFalse(WidgetDados.contem(tvs, null));
        assertFalse(WidgetDados.contem(null, "a1"));
        assertFalse(WidgetDados.contem(new ArrayList<>(), "a1"));
        assertEquals("Quarto", WidgetDados.achar(tvs, "b2").nome);   // renomeada no app: o widget pega o nome novo
        assertNull(WidgetDados.achar(tvs, "zz"));
    }

    @Test public void mensagemDoToastPorErro() {
        assertEquals("Sem internet: a tecla não foi enviada", WidgetDados.mensagemDeErro(0, true));
        assertEquals("Sem internet: a tecla não foi enviada", WidgetDados.mensagemDeErro(500, true));   // sem rede ganha
        assertEquals("Abra o WatchMov e escolha a TV no Controle remoto", WidgetDados.mensagemDeErro(401, false));
        assertEquals("Escolha a TV de novo em Trocar TV", WidgetDados.mensagemDeErro(400, false));
        for (int s : new int[] { 500, 502, 503, 404, 0 })
            assertEquals(String.valueOf(s), "Não deu pra falar com a TV agora", WidgetDados.mensagemDeErro(s, false));
    }

    @Test public void faltaDeInternetNaoEServidorLento() {
        assertTrue(WidgetDados.semRede(new UnknownHostException("x.supabase.co")));   // modo avião: sem DNS
        assertTrue(WidgetDados.semRede(new ConnectException("ENETUNREACH")));
        assertTrue(WidgetDados.semRede(new NoRouteToHostException()));
        assertFalse(WidgetDados.semRede(new SocketTimeoutException("timeout")));
        assertFalse(WidgetDados.semRede(new InterruptedIOException("timeout")));      // callTimeout do OkHttp
        assertFalse(WidgetDados.semRede(new IOException("unexpected end of stream")));
        assertFalse(WidgetDados.semRede(null));
    }

    @Test public void teclaPresaNaFilaPassaDosQuatroSegundos() {
        assertFalse(WidgetDados.velha(0, 3999));
        assertFalse(WidgetDados.velha(0, 4000));               // "passou de" 4 s: no limite ainda vai
        assertTrue(WidgetDados.velha(0, 4001));
        assertFalse(WidgetDados.velha(1_000_000, 1_003_999));  // valores de elapsedRealtime de verdade
        assertTrue(WidgetDados.velha(1_000_000, 1_004_001));
        assertFalse(WidgetDados.velha(5_000, 5_000));          // mandada na hora
    }
}
