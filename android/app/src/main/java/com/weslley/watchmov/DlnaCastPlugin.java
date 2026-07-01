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

    private static final OkHttpClient http = new OkHttpClient();
    private static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final Pattern LOCATION = Pattern.compile("(?im)^LOCATION:\\s*(.+?)\\s*$");
    private static final Pattern NAME = Pattern.compile("(?is)<friendlyName>(.*?)</friendlyName>");
    private static final Pattern CTRL = Pattern.compile("(?is)<controlURL>(.*?)</controlURL>");

    public static class Device { public final String name, controlUrl; Device(String n, String c) { name = n; controlUrl = c; } }
    public static volatile int lastRawResponses = 0;   // diagnóstico: respostas SSDP recebidas

    public static List<Device> discoverSync(Context ctx, int timeoutMs) {
        lastRawResponses = 0;
        Map<String, Device> found = new LinkedHashMap<>();
        WifiManager.MulticastLock lock = null;
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
                    if (found.containsKey(loc)) continue;
                    Device dev = describe(loc);
                    if (dev != null) found.put(loc, dev);
                } catch (Exception ignored) {}
            }
            sock.close();
        } catch (Exception ignored) {
        } finally { if (lock != null) try { lock.release(); } catch (Exception ignored) {} }
        return new ArrayList<>(found.values());
    }

    private static Device describe(String location) {
        try {
            try (Response resp = http.newCall(new Request.Builder().url(location).build()).execute()) {
                if (resp.body() == null) return null;
                String xml = resp.body().string();
                if (!xml.contains("AVTransport")) return null;
                String name = "TV";
                Matcher nm = NAME.matcher(xml);
                if (nm.find()) name = nm.group(1).trim();
                String control = null;
                for (String block : xml.split("(?i)<service>")) {
                    if (block.contains("AVTransport")) { Matcher cm = CTRL.matcher(block); if (cm.find()) { control = cm.group(1).trim(); break; } }
                }
                if (TextUtils.isEmpty(control)) return null;
                URL base = new URL(location);
                String ctrlAbs = control.startsWith("http") ? control
                    : base.getProtocol() + "://" + base.getHost() + (base.getPort() > 0 ? ":" + base.getPort() : "")
                      + (control.startsWith("/") ? control : "/" + control);
                return new Device(name, ctrlAbs);
            }
        } catch (Exception e) { return null; }
    }

    public static void castSync(String controlUrl, String url, String title) throws Exception {
        // protocolInfo + DLNA.ORG_FLAGS: a maioria das TVs (LG/Samsung) EXIGE o <res>
        // com protocolInfo no DIDL, senão ignora o SetAVTransportURI (parece "nada
        // aconteceu"). http-get:*:video/mp4 = streaming HTTP progressivo. OP=01 =
        // aceita seek por byte-range. Como o WVC (contentFeatures.dlna.org / <res>).
        String proto = "http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";
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
        // Stop antes: se a TV já está tocando (cast anterior), o SetAVTransportURI é
        // recusado com "Transition not available" (701). Stop reseta o transporte.
        // Best-effort — se já estiver parada, o erro do Stop é ignorado.
        try { soap(controlUrl, "Stop", envelope("Stop", "<InstanceID>0</InstanceID>")); } catch (Exception ignored) {}
        soap(controlUrl, "SetAVTransportURI", envelope("SetAVTransportURI",
            "<InstanceID>0</InstanceID><CurrentURI>" + esc(url) + "</CurrentURI><CurrentURIMetaData>" + esc(didl) + "</CurrentURIMetaData>"));
        soap(controlUrl, "Play", envelope("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"));
    }

    private static String envelope(String action, String inner) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
            + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
            + "<u:" + action + " xmlns:u=\"" + AVT + "\">" + inner + "</u:" + action + "></s:Body></s:Envelope>";
    }

    private static void soap(String controlUrl, String action, String body) throws Exception {
        Request req = new Request.Builder().url(controlUrl)
            .addHeader("SOAPAction", "\"" + AVT + "#" + action + "\"")
            .post(RequestBody.create(body, MediaType.parse("text/xml; charset=\"utf-8\""))).build();
        try (Response resp = http.newCall(req).execute()) {
            // Valida a resposta: a TV devolve 500 + <UPnPError> quando recusa. Sem
            // isso o cast falhava em silêncio ("nada aconteceu"). Surface o motivo.
            if (!resp.isSuccessful()) {
                String rb = resp.body() != null ? resp.body().string() : "";
                Matcher em = ERRDESC.matcher(rb);
                String why = em.find() ? em.group(1) : ("HTTP " + resp.code());
                throw new Exception(action + " recusado pela TV: " + why);
            }
        }
    }

    private static final Pattern ERRDESC = Pattern.compile("(?is)<errorDescription>(.*?)</errorDescription>");

    // ---- Controle remoto (o celular vira controle da TV) ----
    // Play / Pause / Stop no AVTransport.
    public static void controlSync(String controlUrl, String action) throws Exception {
        String inner = "<InstanceID>0</InstanceID>" + ("Play".equals(action) ? "<Speed>1</Speed>" : "");
        soap(controlUrl, action, envelope(action, inner));
    }

    // Seek absoluto por tempo (REL_TIME = H:MM:SS).
    public static void seekSync(String controlUrl, long targetMs) throws Exception {
        soap(controlUrl, "Seek", envelope("Seek",
            "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>" + hms(targetMs) + "</Target>"));
    }

    // Posição/duração atuais: {posMs, durMs}. Para o tempo no overlay.
    public static long[] getPositionSync(String controlUrl) throws Exception {
        String body = soapResult(controlUrl, "GetPositionInfo", envelope("GetPositionInfo", "<InstanceID>0</InstanceID>"));
        return new long[]{ parseTime(tag(body, "RelTime")), parseTime(tag(body, "TrackDuration")) };
    }

    // Estado do transporte: "PLAYING" / "PAUSED_PLAYBACK" / "STOPPED" / "TRANSITIONING".
    public static String getStateSync(String controlUrl) throws Exception {
        String body = soapResult(controlUrl, "GetTransportInfo", envelope("GetTransportInfo", "<InstanceID>0</InstanceID>"));
        String st = tag(body, "CurrentTransportState");
        return st != null ? st.trim() : "";
    }

    private static String soapResult(String controlUrl, String action, String body) throws Exception {
        Request req = new Request.Builder().url(controlUrl)
            .addHeader("SOAPAction", "\"" + AVT + "#" + action + "\"")
            .post(RequestBody.create(body, MediaType.parse("text/xml; charset=\"utf-8\""))).build();
        try (Response resp = http.newCall(req).execute()) {
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
