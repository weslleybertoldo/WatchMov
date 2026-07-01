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

    public static List<Device> discoverSync(Context ctx, int timeoutMs) {
        Map<String, Device> found = new LinkedHashMap<>();
        WifiManager.MulticastLock lock = null;
        try {
            WifiManager wifi = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) { lock = wifi.createMulticastLock("wm-dlna"); lock.setReferenceCounted(true); lock.acquire(); }
            String msearch = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + AVT + "\r\n\r\n";
            DatagramSocket sock = new DatagramSocket();
            sock.setSoTimeout(timeoutMs);
            byte[] data = msearch.getBytes();
            sock.send(new DatagramPacket(data, data.length, new InetSocketAddress(InetAddress.getByName("239.255.255.250"), 1900)));
            long end = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < end) {
                try {
                    DatagramPacket resp = new DatagramPacket(buf, buf.length);
                    sock.receive(resp);
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
        String didl = "&lt;DIDL-Lite xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/&quot; "
            + "xmlns:dc=&quot;http://purl.org/dc/elements/1.1/&quot; "
            + "xmlns:upnp=&quot;urn:schemas-upnp-org:metadata-1-0/upnp/&quot;&gt;"
            + "&lt;item id=&quot;0&quot; parentID=&quot;-1&quot; restricted=&quot;1&quot;&gt;"
            + "&lt;dc:title&gt;" + esc(title) + "&lt;/dc:title&gt;"
            + "&lt;upnp:class&gt;object.item.videoItem&lt;/upnp:class&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;";
        soap(controlUrl, "SetAVTransportURI", envelope("SetAVTransportURI",
            "<InstanceID>0</InstanceID><CurrentURI>" + esc(url) + "</CurrentURI><CurrentURIMetaData>" + didl + "</CurrentURIMetaData>"));
        soap(controlUrl, "Play", envelope("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"));
    }

    private static String envelope(String action, String inner) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
            + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
            + "<u:" + action + " xmlns:u=\"" + AVT + "\">" + inner + "</u:" + action + "></s:Body></s:Envelope>";
    }

    private static void soap(String controlUrl, String action, String body) throws Exception {
        Request req = new Request.Builder().url(controlUrl)
            .addHeader("SOAPACTION", "\"" + AVT + "#" + action + "\"")
            .post(RequestBody.create(body, MediaType.parse("text/xml; charset=\"utf-8\""))).build();
        try (Response resp = http.newCall(req).execute()) { /* ignora corpo */ }
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
