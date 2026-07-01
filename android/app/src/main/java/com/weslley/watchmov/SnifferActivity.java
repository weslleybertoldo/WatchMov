package com.weslley.watchmov;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * WebView VISÍVEL de captura (estilo Web Video Cast). Mostra a página do servidor
 * pro usuário — que pode resolver captcha / dar play — enquanto o app observa o
 * tráfego. Ao detectar a URL do stream (.m3u8/.mp4/.mpd), devolve pra quem chamou
 * e fecha. O usuário pode voltar a qualquer momento ("Usar servidor" = cancela).
 */
public class SnifferActivity extends Activity {

    public static final String EXTRA_URL = "sniff_url";
    public static final String RESULT_URL = "result_url";
    public static final String RESULT_MIME = "result_mime";
    public static final String RESULT_REFERER = "result_referer";
    private static final String TAG = "WatchMovSniff";

    private WebView web;
    private TextView status;
    private final AtomicBoolean done = new AtomicBoolean(false);

    private static final String INJECT_JS =
        "(function(){try{" +
        "function rep(u){try{u=''+u;if(u&&(u.indexOf('.m3u8')>-1||u.indexOf('.mp4')>-1||u.indexOf('.mpd')>-1)){AndroidSniffer.onUrl(u);}}catch(e){}}" +
        "var of=window.fetch;if(of){window.fetch=function(){try{rep(arguments[0]&&arguments[0].url?arguments[0].url:arguments[0]);}catch(e){}return of.apply(this,arguments);};}" +
        "var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{rep(u);}catch(e){}return oo.apply(this,arguments);};" +
        "function play(){try{var vs=document.getElementsByTagName('video');for(var i=0;i<vs.length;i++){try{var p=vs[i].play();if(p&&p.catch)p.catch(function(){});}catch(e){}}}catch(e){}}" +
        "var n=0;var iv=setInterval(function(){play();if(++n>30)clearInterval(iv);},1000);" +
        "}catch(e){}})();";

    private static boolean looksLikeVideo(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        return u.contains(".m3u8") || u.contains(".mp4") || u.contains(".mpd")
            || u.contains("master.m3u8") || u.contains("/manifest");
    }

    private static String mimeFor(String url) {
        String u = url.toLowerCase();
        if (u.contains(".m3u8") || u.contains("master") || u.contains("/manifest")) return "application/vnd.apple.mpegurl";
        if (u.contains(".mpd")) return "application/dash+xml";
        return "video/mp4";
    }

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null) { setResult(RESULT_CANCELED); finish(); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);

        // Barra superior: status + botão "Usar servidor" (cancela captura).
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(Color.parseColor("#111111"));
        bar.setPadding(24, 20, 24, 20);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        status = new TextView(this);
        status.setText("🔍 Procurando o vídeo… dê play ou resolva a verificação, se aparecer.");
        status.setTextColor(Color.WHITE);
        status.setTextSize(13);
        status.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button close = new Button(this);
        close.setText("Usar servidor");
        close.setAllCaps(false);
        close.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });

        bar.addView(status);
        bar.addView(close);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void onUrl(String u) {
                Log.d(TAG, "JS video: " + u);
                if (looksLikeVideo(u)) capture(u, mimeFor(u), null);
            }
        }, "AndroidSniffer");

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl() != null ? request.getUrl().toString() : null;
                if (looksLikeVideo(reqUrl)) {
                    String ref = null;
                    Map<String, String> h = request.getRequestHeaders();
                    if (h != null) ref = h.get("Referer");
                    Log.d(TAG, "NET video: " + reqUrl);
                    capture(reqUrl, mimeFor(reqUrl), ref);
                }
                return null;
            }
            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                view.evaluateJavascript(INJECT_JS, null);
            }
        });

        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        Log.d(TAG, "SnifferActivity load: " + url);
        web.loadUrl(url);
    }

    private void capture(String url, String mime, String referer) {
        if (!done.compareAndSet(false, true)) return;
        Log.d(TAG, "CAPTURE: " + url);
        runOnUiThread(() -> {
            if (status != null) status.setText("✅ Vídeo encontrado! Abrindo no seu player…");
            Intent data = new Intent();
            data.putExtra(RESULT_URL, url);
            data.putExtra(RESULT_MIME, mime);
            if (referer != null) data.putExtra(RESULT_REFERER, referer);
            setResult(RESULT_OK, data);
            // pequeno atraso pra UI confirmar antes de fechar
            web.postDelayed(this::finish, 350);
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            try {
                ViewGroup p = (ViewGroup) web.getParent();
                if (p != null) p.removeView(web);
                web.stopLoading();
                web.destroy();
            } catch (Exception ignored) {}
            web = null;
        }
        super.onDestroy();
    }
}
