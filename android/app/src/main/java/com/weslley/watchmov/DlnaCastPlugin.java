package com.weslley.watchmov;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Espelhar na TV via DLNA/UPnP (como o Web Video Cast): descobre renderizadores
 * por SSDP, acha o AVTransport e manda a URL por SOAP (SetAVTransportURI + Play).
 * A TV toca sozinha; o celular fica livre. Lógica estática reutilizável pelo
 * player nativo (botão TV).
 */
@CapacitorPlugin(name = "DlnaCast")
public class DlnaCastPlugin extends Plugin {

    // Comandos (describe/control/seek): timeouts LIMITADOS. O padrão do OkHttp
    // (sem callTimeout) segura a thread até 10s por chamada; numa TV lenta isso
    // empilhava requisições. Aqui abandona em ~10s no pior caso, não "para sempre".
    private static final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .build();
    // CAST (SetAVTransportURI/Play): a LG SONDA a URL (HEAD/GET no proxy do celular)
    // ANTES de responder o SOAP — com stream online isso passa de 8s e o comando
    // morria em "Read timed out"/"timeout" com a TV ainda em "Loading media
    // resource…". Aqui a espera é maior; o proxy pré-aquecido (prewarm) encurta.
    private static final OkHttpClient httpCast = new OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .build();
    // POLL (GetPositionInfo/GetTransportInfo): a TV é consultada a cada ciclo. Se
    // uma resposta demora (ex.: TRANSITIONING no início), abandona rápido (~3s) em
    // vez de travar a thread e afogar o controle UPnP da TV com chamadas empilhadas.
    private static final OkHttpClient httpPoll = new OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2500, TimeUnit.MILLISECONDS)
        .callTimeout(3, TimeUnit.SECONDS)
        .build();
    private static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final Pattern LOCATION = Pattern.compile("(?im)^LOCATION:\\s*(.+?)\\s*$");
    private static final Pattern NAME = Pattern.compile("(?is)<friendlyName>(.*?)</friendlyName>");
    private static final Pattern CTRL = Pattern.compile("(?is)<controlURL>(.*?)</controlURL>");

    public static class Device {
        public final String name, controlUrl, location;
        public final String renderUrl;   // controlURL do RenderingControl (volume) — null se a TV não expõe
        Device(String n, String c, String loc, String render) { name = n; controlUrl = c; location = loc; renderUrl = render; }
        /** IP da TV (host do controlUrl) — é por ele que o proxy filtra o tráfego dela. */
        public String ip() { try { return new URL(controlUrl).getHost(); } catch (Exception e) { return null; } }
    }
    public static volatile int lastRawResponses = 0;   // diagnóstico: respostas SSDP recebidas
    // Resumo da última descoberta pro evento DLNA_DESCOBERTA: quantas respostas SSDP,
    // quantos LOCATIONs distintos, quantos descritos sem AVTransport (não é
    // renderizador), erros de describe, e as TVs achadas (nome@ip).
    public static volatile String lastDiscoverySummary = "";

    public static List<Device> discoverSync(Context ctx, int timeoutMs) {
        lastRawResponses = 0;
        Map<String, Device> found = new LinkedHashMap<>();
        java.util.Set<String> locations = new java.util.LinkedHashSet<>();
        int semAvt = 0, describeErr = 0;
        WifiManager.MulticastLock lock = null;
        long t0 = System.currentTimeMillis();
        try {
            WifiManager wifi = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) { lock = wifi.createMulticastLock("wm-dlna"); lock.setReferenceCounted(true); lock.acquire(); }
            DatagramSocket sock = new DatagramSocket();
            sock.setSoTimeout(800);
            sock.setBroadcast(true);
            InetAddress multicast = InetAddress.getByName("239.255.255.250");
            InetAddress broadcast = InetAddress.getByName("255.255.255.255");   // rede c/ IGMP snooping / multicast off
            // Nem toda TV responde ao ST específico — busca vários tipos, repetido,
            // por multicast E broadcast (roteadores que bloqueiam multicast).
            String[] targets = { "ssdp:all", "urn:schemas-upnp-org:device:MediaRenderer:1", AVT, "upnp:rootdevice" };
            for (int r = 0; r < 2; r++) for (String st : targets) {
                for (InetAddress dst : new InetAddress[]{ multicast, broadcast }) {
                    String ms = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n";
                    try { byte[] b = ms.getBytes(); sock.send(new DatagramPacket(b, b.length, dst, 1900)); } catch (Exception ignored) {}
                }
            }
            long end = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < end) {
                try {
                    DatagramPacket resp = new DatagramPacket(buf, buf.length);
                    sock.receive(resp);
                    lastRawResponses++;
                    String text = new String(resp.getData(), 0, resp.getLength());
                    Matcher m = LOCATION.matcher(text);
                    if (!m.find()) continue;
                    String loc = m.group(1).trim();
                    if (!locations.add(loc)) continue;
                    Device dev = describe(loc);
                    if (dev != null) found.put(loc, dev);
                    else if (lastDescribeHadXml) semAvt++;
                    else describeErr++;
                } catch (Exception ignored) {}
            }
            sock.close();
        } catch (Exception ignored) {
        } finally { if (lock != null) try { lock.release(); } catch (Exception ignored) {} }
        StringBuilder sb = new StringBuilder();
        sb.append("respostas=").append(lastRawResponses).append(" locations=").append(locations.size())
          .append(" semAVTransport=").append(semAvt).append(" describeErr=").append(describeErr)
          .append(" tvs=[");
        int i = 0;
        for (Device d : found.values()) { if (i++ > 0) sb.append(", "); sb.append(d.name).append('@').append(d.ip()); }
        sb.append("] ").append(System.currentTimeMillis() - t0).append("ms");
        lastDiscoverySummary = sb.toString();
        return new ArrayList<>(found.values());
    }

    private static volatile boolean lastDescribeHadXml = false;

    private static Device describe(String location) {
        lastDescribeHadXml = false;
        try {
            try (Response resp = http.newCall(new Request.Builder().url(location).build()).execute()) {
                if (resp.body() == null) return null;
                String xml = resp.body().string();
                lastDescribeHadXml = xml != null && xml.contains("<");
                if (!xml.contains("AVTransport")) return null;
                String name = "TV";
                Matcher nm = NAME.matcher(xml);
                if (nm.find()) name = nm.group(1).trim();
                String control = null, render = null;
                for (String block : xml.split("(?i)<service>")) {
                    if (control == null && block.contains("AVTransport")) { Matcher cm = CTRL.matcher(block); if (cm.find()) control = cm.group(1).trim(); }
                    else if (render == null && block.contains("RenderingControl")) { Matcher cm = CTRL.matcher(block); if (cm.find()) render = cm.group(1).trim(); }
                }
                if (TextUtils.isEmpty(control)) return null;
                URL base = new URL(location);
                return new Device(name, absUrl(base, control), location, TextUtils.isEmpty(render) ? null : absUrl(base, render));
            }
        } catch (Exception e) { return null; }
    }

    /** Resultado do cast: o que foi mandado e quanto cada etapa levou (pro diagnóstico). */
    public static final class CastResult {
        public String protocolInfo = "";
        public long msStop = -1, msSet = -1, msPlay = -1;   // -1 = etapa não executada
        public boolean stopUsed = false, setRetried = false;
        public String etapaFalha = null;                    // "Stop"/"SetAVTransportURI"/"Play" quando falhou
        @Override public String toString() {
            return "proto=" + protocolInfo.replace("http-get:*:", "").split(":")[0]
                + (stopUsed ? " stop=" + msStop + "ms" : "")
                + " set=" + msSet + "ms" + (setRetried ? "(retry pos-Stop)" : "")
                + " play=" + msPlay + "ms"
                + (etapaFalha != null ? " FALHOU_EM=" + etapaFalha : "");
        }
    }

    /** Exceção do cast carregando o CastResult parcial (etapa que falhou + tempos). */
    public static final class CastException extends Exception {
        public final CastResult result;
        CastException(String msg, CastResult r, Throwable cause) { super(msg, cause); result = r; }
    }

    public static CastResult castSync(String controlUrl, String url, String title) throws Exception {
        return castSync(controlUrl, url, title, true);
    }

    /**
     * stopFirst=false: TENTA trocar a mídia sem parar a TV (é o "Próximo episódio" —
     * o Stop é o que faz a TV piscar/"desconectar"). Se ela recusar o
     * SetAVTransportURI ("Transition not available"), aí sim manda Stop e repete.
     * Lança CastException (com etapa + tempos) quando a TV recusa/não responde.
     */
    public static CastResult castSync(String controlUrl, String url, String title, boolean stopFirst) throws Exception {
        CastResult res = new CastResult();
        // protocolInfo + DLNA.ORG_FLAGS: a maioria das TVs (LG/Samsung) EXIGE o <res>
        // com protocolInfo no DIDL, senão ignora o SetAVTransportURI (parece "nada
        // aconteceu"). http-get:*:video/mp4 = streaming HTTP progressivo. OP=01 =
        // aceita seek por byte-range. Como o WVC (contentFeatures.dlna.org / <res>).
        // Vale tanto pro HLS (comprovado nas duas TVs) quanto pro MP4 exportado
        // servido pelo proxy (content:// → HTTP com Range).
        String proto = "http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";
        res.protocolInfo = proto;
        // DIDL como XML NORMAL (esc só na url/title = nível DIDL); depois esc() no DIDL
        // INTEIRO pro CurrentURIMetaData → escape DUPLO. A URL do proxy tem `&` (?u=..&r=..);
        // com escape simples a TV desescapa 1x e sobra `&` cru no DIDL interno → XML inválido
        // → "Invalid Args" (402). O escape duplo entrega `&amp;` válido no DIDL interno.
        String didl = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" "
            + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
            + "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
            + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
            + "<dc:title>" + esc(title) + "</dc:title>"
            + "<res protocolInfo=\"" + proto + "\">" + esc(url) + "</res>"
            + "<upnp:class>object.item.videoItem</upnp:class></item></DIDL-Lite>";
        final String setUri = envelope("SetAVTransportURI",
            "<InstanceID>0</InstanceID><CurrentURI>" + esc(url) + "</CurrentURI><CurrentURIMetaData>" + esc(didl) + "</CurrentURIMetaData>");
        // Stop antes: se a TV já está tocando (cast anterior), o SetAVTransportURI pode
        // ser recusado com "Transition not available" (701). Stop reseta o transporte.
        // Best-effort — se já estiver parada, o erro do Stop é ignorado.
        // Na TROCA DE EPISÓDIO (stopFirst=false) o Stop é justamente o que faz a TV
        // "cair": tenta direto e só para a TV se ela REALMENTE recusar.
        long t;
        if (stopFirst) {
            t = System.currentTimeMillis();
            res.stopUsed = true;
            try { soap(http, controlUrl, "Stop", envelope("Stop", "<InstanceID>0</InstanceID>")); } catch (Exception ignored) {}
            res.msStop = System.currentTimeMillis() - t;
            t = System.currentTimeMillis();
            try { soap(httpCast, controlUrl, "SetAVTransportURI", setUri); }
            catch (Exception e) { res.msSet = System.currentTimeMillis() - t; res.etapaFalha = "SetAVTransportURI"; throw new CastException(e.getMessage(), res, e); }
            res.msSet = System.currentTimeMillis() - t;
        } else {
            t = System.currentTimeMillis();
            try {
                soap(httpCast, controlUrl, "SetAVTransportURI", setUri);
                res.msSet = System.currentTimeMillis() - t;
            } catch (Exception recusou) {
                res.setRetried = true; res.stopUsed = true;
                long ts = System.currentTimeMillis();
                try { soap(http, controlUrl, "Stop", envelope("Stop", "<InstanceID>0</InstanceID>")); } catch (Exception ignored) {}
                res.msStop = System.currentTimeMillis() - ts;
                try { Thread.sleep(600); } catch (InterruptedException ignored) {}
                try { soap(httpCast, controlUrl, "SetAVTransportURI", setUri); }
                catch (Exception e2) { res.msSet = System.currentTimeMillis() - t; res.etapaFalha = "SetAVTransportURI"; throw new CastException(e2.getMessage() + " (1ª tentativa: " + recusou.getMessage() + ")", res, e2); }
                res.msSet = System.currentTimeMillis() - t;
            }
        }
        t = System.currentTimeMillis();
        try { soap(httpCast, controlUrl, "Play", envelope("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")); }
        catch (Exception e) { res.msPlay = System.currentTimeMillis() - t; res.etapaFalha = "Play"; throw new CastException(e.getMessage(), res, e); }
        res.msPlay = System.currentTimeMillis() - t;
        return res;
    }

    // controlURL relativo → absoluto (base = LOCATION do device).
    private static String absUrl(URL base, String control) {
        return control.startsWith("http") ? control
            : base.getProtocol() + "://" + base.getHost() + (base.getPort() > 0 ? ":" + base.getPort() : "")
              + (control.startsWith("/") ? control : "/" + control);
    }

    // ---- Volume (RenderingControl) — o celular vira controle de volume da TV ----
    private static final String RCS = "urn:schemas-upnp-org:service:RenderingControl:1";

    /** Volume atual da TV (0–100) ou -1 se ela não informar. */
    public static int getVolumeSync(String renderUrl) throws Exception {
        String body = soapResult(renderUrl, RCS, "GetVolume", envelope(RCS, "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>"));
        String v = tag(body, "CurrentVolume");
        try { return v != null ? Integer.parseInt(v.trim()) : -1; } catch (NumberFormatException e) { return -1; }
    }

    public static void setVolumeSync(String renderUrl, int vol) throws Exception {
        int v = Math.max(0, Math.min(100, vol));
        soap(http, renderUrl, RCS, "SetVolume", envelope(RCS, "SetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>" + v + "</DesiredVolume>"));
    }

    private static String envelope(String action, String inner) { return envelope(AVT, action, inner); }

    private static String envelope(String service, String action, String inner) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
            + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
            + "<u:" + action + " xmlns:u=\"" + service + "\">" + inner + "</u:" + action + "></s:Body></s:Envelope>";
    }

    private static void soap(OkHttpClient client, String controlUrl, String action, String body) throws Exception { soap(client, controlUrl, AVT, action, body); }

    private static void soap(OkHttpClient client, String controlUrl, String service, String action, String body) throws Exception {
        Request req = new Request.Builder().url(controlUrl)
            .addHeader("SOAPAction", "\"" + service + "#" + action + "\"")
            .post(RequestBody.create(body, MediaType.parse("text/xml; charset=\"utf-8\""))).build();
        try (Response resp = client.newCall(req).execute()) {
            // Valida a resposta: a TV devolve 500 + <UPnPError> quando recusa. Sem
            // isso o cast falhava em silêncio ("nada aconteceu"). Surface o motivo.
            if (!resp.isSuccessful()) {
                String rb = resp.body() != null ? resp.body().string() : "";
                Matcher em = ERRDESC.matcher(rb);
                Matcher ec = ERRCODE.matcher(rb);
                String why = em.find() ? em.group(1) : ("HTTP " + resp.code());
                if (ec.find()) why = why + " (UPnP " + ec.group(1) + ")";
                throw new Exception(action + " recusado pela TV: " + why);
            }
        } catch (java.io.IOException io) {
            // Timeout/conexão: diz QUAL ação e o que aconteceu ("timeout" seco não
            // dizia se foi o SetAVTransportURI ou o Play).
            String m = io.getMessage() != null ? io.getMessage() : io.getClass().getSimpleName();
            throw new Exception(action + " sem resposta da TV: " + m, io);
        }
    }

    private static final Pattern ERRDESC = Pattern.compile("(?is)<errorDescription>(.*?)</errorDescription>");
    private static final Pattern ERRCODE = Pattern.compile("(?is)<errorCode>(.*?)</errorCode>");

    // ---- Controle remoto (o celular vira controle da TV) ----
    // Play / Pause / Stop no AVTransport.
    public static void controlSync(String controlUrl, String action) throws Exception {
        String inner = "<InstanceID>0</InstanceID>" + ("Play".equals(action) ? "<Speed>1</Speed>" : "");
        soap(http, controlUrl, action, envelope(action, inner));
    }

    // Seek absoluto por tempo (REL_TIME = H:MM:SS).
    public static void seekSync(String controlUrl, long targetMs) throws Exception {
        soap(http, controlUrl, "Seek", envelope("Seek",
            "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>" + hms(targetMs) + "</Target>"));
    }

    // Posição/duração atuais: {posMs, durMs}. Para o tempo no overlay.
    public static long[] getPositionSync(String controlUrl) throws Exception {
        String body = soapResult(controlUrl, "GetPositionInfo", envelope("GetPositionInfo", "<InstanceID>0</InstanceID>"));
        return new long[]{ parseTime(tag(body, "RelTime")), parseTime(tag(body, "TrackDuration")) };
    }

    // Estado do transporte: "PLAYING" / "PAUSED_PLAYBACK" / "STOPPED" / "TRANSITIONING".
    public static String getStateSync(String controlUrl) throws Exception {
        return getTransportInfoSync(controlUrl)[0];
    }

    // {estado, status}: status = "OK" ou "ERROR_OCCURRED" — é a TV dizendo que
    // tentou tocar e FALHOU (formato/rede), o que separa "carregando" de "quebrou".
    public static String[] getTransportInfoSync(String controlUrl) throws Exception {
        String body = soapResult(controlUrl, "GetTransportInfo", envelope("GetTransportInfo", "<InstanceID>0</InstanceID>"));
        String st = tag(body, "CurrentTransportState");
        String status = tag(body, "CurrentTransportStatus");
        return new String[]{ st != null ? st.trim() : "", status != null ? status.trim() : "" };
    }

    // URI que a TV diz estar tocando (GetMediaInfo) — confirma se ela já pegou a
    // NOSSA URL ou ainda segura a mídia anterior.
    public static String getCurrentUriSync(String controlUrl) throws Exception {
        String body = soapResult(controlUrl, "GetMediaInfo", envelope("GetMediaInfo", "<InstanceID>0</InstanceID>"));
        String uri = tag(body, "CurrentURI");
        return uri != null ? uri.trim().replace("&amp;", "&") : "";
    }

    private static String soapResult(String controlUrl, String action, String body) throws Exception { return soapResult(controlUrl, AVT, action, body); }

    private static String soapResult(String controlUrl, String service, String action, String body) throws Exception {
        Request req = new Request.Builder().url(controlUrl)
            .addHeader("SOAPAction", "\"" + service + "#" + action + "\"")
            .post(RequestBody.create(body, MediaType.parse("text/xml; charset=\"utf-8\""))).build();
        // cliente de poll (timeout curto) — não segura a thread numa TV lenta
        try (Response resp = httpPoll.newCall(req).execute()) {
            String rb = resp.body() != null ? resp.body().string() : "";
            if (!resp.isSuccessful()) throw new Exception(action + " HTTP " + resp.code());
            return rb;
        }
    }

    private static String hms(long ms) {
        long s = Math.max(0, ms) / 1000;
        return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    }

    private static long parseTime(String t) {
        if (t == null) return 0;
        String[] p = t.trim().split(":");
        try {
            if (p.length == 3) return (long) ((Long.parseLong(p[0]) * 3600 + Long.parseLong(p[1]) * 60 + Double.parseDouble(p[2])) * 1000);
        } catch (Exception ignored) {}
        return 0;
    }

    private static String tag(String body, String name) {
        Matcher m = Pattern.compile("(?is)<" + name + ">(.*?)</" + name + ">").matcher(body);
        return m.find() ? m.group(1) : null;
    }

    private static String esc(String s) { return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }

    @PluginMethod
    public void discover(final PluginCall call) {
        new Thread(() -> {
            List<Device> devs = discoverSync(getContext(), call.getInt("timeoutMs", 4000));
            JSArray arr = new JSArray();
            for (Device d : devs) { JSObject o = new JSObject(); o.put("name", d.name); o.put("controlUrl", d.controlUrl); arr.put(o); }
            JSObject res = new JSObject(); res.put("devices", arr); call.resolve(res);
        }).start();
    }

    @PluginMethod
    public void cast(final PluginCall call) {
        final String controlUrl = call.getString("controlUrl");
        final String url = call.getString("url");
        if (controlUrl == null || url == null) { call.reject("missing"); return; }
        new Thread(() -> {
            try { castSync(controlUrl, url, call.getString("title", "WatchMov")); call.resolve(); }
            catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : "cast_fail"); }
        }).start();
    }
}
