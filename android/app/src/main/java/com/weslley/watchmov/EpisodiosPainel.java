package com.weslley.watchmov;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.TextUtils;
import android.util.LruCache;
import android.view.FocusFinder;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Painel "Episódios" do player (pedido dele 06/11/2026, com as 2 fotos aprovadas): cartão embaixo, por cima do vídeo,
 * com "Episódios · <série>", as temporadas (T1 T2 …), um ✕ e a fileira de episódios da temporada — frame da TMDB,
 * número no meio, duração, ✓ verde e frame cinza nos assistidos (como na página da série), "ASSISTINDO" + barra no
 * que está tocando. Abre com o foco no episódio atual e com até 3 antes dele à vista. Mesmo visual do painel ⚙
 * (cartão #F215121D, foco roxo com borda branca). Os dados de cada temporada o PlayerActivity monta (EpisodiosDados:
 * o que o app mandou na abertura + a TMDB) e entrega em receber().
 */
final class EpisodiosPainel {

    interface Acoes {
        /** Busca os episódios da temporada (a resposta chega em receber). false = não tem como buscar. */
        boolean pedirTemporada(int temporada);
        /** `visto` = já assistido (recomeça do início em vez de abrir no fim, onde parou da última vez). */
        void tocar(int temporada, int episodio, boolean visto);
        /** O painel sumiu: pelo Voltar/✕/toque fora (escolheu = false) ou porque um episódio foi escolhido. */
        void fechou(boolean escolheu);
    }

    private static final int PILULAS_NO_TOPO = 8;        // mais temporadas que isso = linha própria, rolando
    private static final long ESPERA_MS = 15000;          // sem resposta nesse tempo = aviso (a TMDB demora até ~12 s pra falhar)
    private static final LruCache<String, Bitmap> IMAGENS = new LruCache<String, Bitmap>(8 * 1024 * 1024) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };
    private static final java.util.concurrent.ExecutorService BAIXAR = java.util.concurrent.Executors.newFixedThreadPool(2);
    private static okhttp3.OkHttpClient http;

    private final Activity act;
    private final FrameLayout raiz;
    private final boolean tv;
    private final Acoes acoes;
    private final Map<Integer, EpisodiosDados> cache = new HashMap<>();
    private int[] temporadas = new int[0];

    private FrameLayout fundo;
    private View cartao;
    private TextView serieTv, fecharTv, aviso;
    private LinearLayout pilulasTopo, pilulasLinha;
    private HorizontalScrollView pilulasRolagem, linha;
    private LinearLayout trilho;
    private final List<View> cards = new ArrayList<>();
    private final List<View> pilulas = new ArrayList<>();
    private int temporadaMostrada, tempAtual, epAtual, pctAtual, ultimoFoco;
    private boolean vistoAtual, focarAoChegar;
    private long posAtual;
    private final Runnable semResposta = () -> {
        if (aberto() && cards.isEmpty()) mostrarAviso("Não deu pra carregar os episódios. Feche e abra de novo.");
    };

    EpisodiosPainel(Activity act, FrameLayout raiz, boolean tv, Acoes acoes) {
        this.act = act; this.raiz = raiz; this.tv = tv; this.acoes = acoes;
    }

    boolean aberto() { return fundo != null && fundo.getVisibility() == View.VISIBLE; }

    /** Episódios de uma temporada chegaram do app (já na thread da tela). Guarda e, se é a que está aberta, mostra. */
    void receber(EpisodiosDados d) {
        if (d == null) return;
        EpisodiosDados velho = cache.put(d.temporada, d);
        if (d.temporadas.length > 0) temporadas = d.temporadas;
        if (!aberto()) return;
        if (pilulas.size() != (temporadas.length > 1 ? temporadas.length : 0)) montarPilulas();
        if (d.temporada != temporadaMostrada) return;
        fundo.removeCallbacks(semResposta);
        if (velho != null && mesmosEpisodios(velho, d) && cards.size() == d.eps.size()) {
            for (int i = 0; i < cards.size(); i++) aplicarEstado(cards.get(i), d.eps.get(i), d.temporada);   // só o estado
        } else {
            View f = act.getCurrentFocus();
            int idx = cards.indexOf(f);
            preencher(d, focarAoChegar || idx >= 0, idx >= 0 ? d.indiceDo(((EpisodiosDados.Ep) f.getTag()).numero) : -1);
        }
    }

    /** Abre com o foco no episódio que está tocando (`visto`/`pct`/`posMs` = o estado AO VIVO dele no player). */
    void abrir(String serie, int temporada, int episodio, boolean visto, int pct, long posMs) {
        if (fundo == null) montar();
        tempAtual = temporada; epAtual = episodio; vistoAtual = visto; pctAtual = pct; posAtual = posMs;
        serieTv.setText(serie == null ? "" : serie);
        serieTv.setVisibility(TextUtils.isEmpty(serie) ? View.GONE : View.VISIBLE);
        fundo.animate().cancel(); cartao.animate().cancel();
        fundo.setAlpha(0f); cartao.setTranslationY(dp(24));
        fundo.setVisibility(View.VISIBLE);
        fundo.animate().alpha(1f).setDuration(200).start();
        cartao.animate().translationY(0).setDuration(200).start();
        montarPilulas();
        mostrarTemporada(temporada, true);
    }

    void fechar(final boolean escolheu) {
        if (!aberto()) return;
        fundo.removeCallbacks(semResposta);
        fundo.animate().cancel(); cartao.animate().cancel();
        fundo.animate().alpha(0f).setDuration(180).withEndAction(() -> {
            fundo.setVisibility(View.GONE);
            acoes.fechou(escolheu);
        }).start();
        cartao.animate().translationY(dp(24)).setDuration(180).start();
    }

    // ── Temporadas ──

    private void mostrarTemporada(int t, boolean focarCards) {
        temporadaMostrada = t;
        for (View p : pilulas) p.setSelected(((Integer) p.getTag()) == t);
        EpisodiosDados d = cache.get(t);
        focarAoChegar = focarCards;
        if (d != null) preencher(d, focarCards, -1);
        else {
            trilho.removeAllViews(); cards.clear();
            mostrarAviso("Carregando episódios…");
            if (focarCards) fecharTv.requestFocus();   // o foco não pode ficar no vídeo atrás do painel
        }
        // Sempre pede de novo: assistidos e progresso podem ter mudado desde a última vez (o que já tinha aparece já).
        fundo.removeCallbacks(semResposta);
        if (!acoes.pedirTemporada(t)) { if (d == null) mostrarAviso("Não deu pra carregar os episódios."); }
        else if (d == null) fundo.postDelayed(semResposta, ESPERA_MS);
    }

    private void montarPilulas() {
        pilulasTopo.removeAllViews(); pilulasLinha.removeAllViews(); pilulas.clear();
        boolean varias = temporadas.length > 1;
        boolean naLinha = temporadas.length > PILULAS_NO_TOPO;
        pilulasRolagem.setVisibility(varias && naLinha ? View.VISIBLE : View.GONE);
        pilulasTopo.setVisibility(varias && !naLinha ? View.VISIBLE : View.GONE);
        if (!varias) return;
        LinearLayout destino = naLinha ? pilulasLinha : pilulasTopo;
        for (final int t : temporadas) {
            TextView p = new TextView(act);
            p.setText("T" + t);
            p.setTag(t);
            p.setTextSize(14);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            p.setTextColor(new ColorStateList(
                new int[][] { { android.R.attr.state_focused }, { android.R.attr.state_selected }, {} },
                new int[] { Color.WHITE, Color.WHITE, Color.parseColor("#BFFFFFFF") }));
            p.setGravity(Gravity.CENTER);
            p.setPadding(dp(13), 0, dp(13), 0);
            p.setBackground(fundoDaPilula());
            p.setFocusable(true); p.setClickable(true);
            p.setSelected(t == temporadaMostrada);
            p.setOnClickListener(v -> { if (t != temporadaMostrada) mostrarTemporada(t, false); });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(30));
            lp.leftMargin = dp(8);
            destino.addView(p, lp);
            pilulas.add(p);
        }
    }

    // ── Episódios ──

    private void preencher(EpisodiosDados d, boolean focar, int indiceFoco) {
        aviso.setVisibility(View.GONE);
        linha.setVisibility(View.VISIBLE);
        if (d.temporada == tempAtual) {   // o que está tocando: estado ao vivo do player, não o da última leitura
            int i = d.indiceDo(epAtual);
            if (i >= 0) { d.eps.get(i).visto = vistoAtual; d.eps.get(i).pct = vistoAtual ? 0 : pctAtual; }
        }
        trilho.removeAllViews(); cards.clear();
        for (EpisodiosDados.Ep e : d.eps) {
            View c = card(e, d.temporada);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(larguraDoCard()), ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = dp(10);
            trilho.addView(c, lp);
            cards.add(c);
        }
        if (cards.isEmpty()) { mostrarAviso("Esta temporada ainda não tem episódios."); return; }
        final int foco = indiceFoco >= 0 ? indiceFoco : d.indiceInicial(tempAtual, epAtual);
        ultimoFoco = foco;
        focarAoChegar = false;   // o foco pedido na abertura foi usado aqui; a resposta seguinte não rouba o foco
        linha.post(() -> {
            if (foco >= cards.size()) return;
            linha.scrollTo(cards.get(EpisodiosDados.primeiroVisivel(foco)).getLeft(), 0);
            if (focar) cards.get(foco).requestFocus();
            carregarImagensPerto(foco);
        });
    }

    private View card(final EpisodiosDados.Ep e, final int temporada) {
        LinearLayout c = new LinearLayout(act);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(6), dp(6), dp(6), dp(8));
        c.setBackground(fundoDoCard());
        c.setFocusable(true); c.setClickable(true);
        c.setTag(e);

        FrameLayout quadro = new FrameLayout(act);
        GradientDrawable q = new GradientDrawable();
        q.setColor(Color.parseColor("#FF222222")); q.setCornerRadius(dp(8));
        quadro.setBackground(q);
        quadro.setClipToOutline(true);
        ImageView img = new ImageView(act);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        quadro.addView(img, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView num = etiqueta(String.valueOf(e.numero), 13, "#99000000", 4);
        num.setPadding(dp(7), dp(1), dp(7), dp(1));
        quadro.addView(num, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        if (e.minutos > 0 && e.emBreve == null) {
            TextView dur = etiqueta(e.minutos + "min", 9, "#B3000000", 3);
            dur.setTypeface(Typeface.DEFAULT);
            dur.setPadding(dp(4), dp(2), dp(4), dp(2));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.START);
            lp.leftMargin = dp(4); lp.bottomMargin = dp(6);
            quadro.addView(dur, lp);
        }

        TextView check = new TextView(act);   // ✓ verde dos assistidos (o mesmo selo da página da série)
        check.setText("✓"); check.setTextColor(Color.WHITE); check.setTextSize(11);
        check.setTypeface(Typeface.DEFAULT_BOLD); check.setGravity(Gravity.CENTER);
        GradientDrawable verde = new GradientDrawable();
        verde.setShape(GradientDrawable.OVAL); verde.setColor(Color.parseColor("#22C55E"));
        check.setBackground(verde);
        FrameLayout.LayoutParams lpc = new FrameLayout.LayoutParams(dp(18), dp(18), Gravity.TOP | Gravity.END);
        lpc.topMargin = dp(4); lpc.rightMargin = dp(4);
        quadro.addView(check, lpc);

        TextView agora = etiqueta("ASSISTINDO", 9, "#7C3AED", 4);
        agora.setPadding(dp(6), dp(2), dp(6), dp(2));
        FrameLayout.LayoutParams lpa = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        lpa.topMargin = dp(4); lpa.leftMargin = dp(4);
        quadro.addView(agora, lpa);

        LinearLayout barra = new LinearLayout(act);   // progresso de quem parou no meio (branco sobre escuro)
        barra.setBackgroundColor(Color.parseColor("#99000000"));
        View feito = new View(act);
        feito.setBackgroundColor(Color.WHITE);
        barra.addView(feito, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0));
        barra.addView(new View(act), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 100));
        quadro.addView(barra, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.BOTTOM));

        int larguraImg = larguraDoCard() - 12;
        c.addView(quadro, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(larguraImg * 9 / 16)));

        TextView nome = new TextView(act);
        nome.setText(e.nome != null ? e.nome : "Episódio " + e.numero);
        nome.setTextSize(12.5f);
        nome.setTypeface(Typeface.DEFAULT_BOLD);
        nome.setLines(2);
        nome.setEllipsize(TextUtils.TruncateAt.END);
        nome.setLineSpacing(0, 1.05f);
        LinearLayout.LayoutParams lpn = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpn.topMargin = dp(7);
        c.addView(nome, lpn);

        TextView info = new TextView(act);
        info.setTextSize(11);
        info.setSingleLine(true);
        info.setEllipsize(TextUtils.TruncateAt.END);
        info.setDuplicateParentStateEnabled(true);
        info.setTextColor(new ColorStateList(new int[][] { { android.R.attr.state_focused }, {} },
            new int[] { Color.parseColor("#E6FFFFFF"), Color.parseColor("#A6FFFFFF") }));
        LinearLayout.LayoutParams lpi = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpi.topMargin = dp(2);
        c.addView(info, lpi);

        c.setOnFocusChangeListener((v, tem) -> {
            v.animate().scaleX(tem ? 1.07f : 1f).scaleY(tem ? 1.07f : 1f).setDuration(120).start();
            v.setTranslationZ(tem ? dp(4) : 0);
            if (tem) { ultimoFoco = cards.indexOf(v); carregarImagensPerto(ultimoFoco); }
        });
        c.setOnClickListener(v -> {
            v.animate().cancel();
            acoes.tocar(temporada, e.numero, ((EpisodiosDados.Ep) v.getTag()).visto);
        });
        aplicarEstado(c, e, temporada);
        return c;
    }

    /** Assistido / tocando agora / progresso / "Em breve" num card já montado (a resposta nova só muda isso). */
    private void aplicarEstado(View c, EpisodiosDados.Ep e, int temporada) {
        c.setTag(e);
        LinearLayout card = (LinearLayout) c;
        FrameLayout quadro = (FrameLayout) card.getChildAt(0);
        ImageView img = (ImageView) quadro.getChildAt(0);
        boolean atual = temporada == tempAtual && e.numero == epAtual;
        if (atual) { e.visto = vistoAtual; e.pct = vistoAtual ? 0 : pctAtual; }
        // Assistido = frame cinza e apagado (como na página da série); "Em breve" = só apagado.
        img.setImageAlpha(e.visto || e.emBreve != null ? 102 : 255);
        if (e.visto) {
            ColorMatrix cm = new ColorMatrix(); cm.setSaturation(0);
            img.setColorFilter(new ColorMatrixColorFilter(cm));
        } else img.clearColorFilter();
        int filhos = quadro.getChildCount();
        // Ordem dos filhos do quadro: imagem, número, [duração], ✓, ASSISTINDO, barra.
        View barra = quadro.getChildAt(filhos - 1);
        View agora = quadro.getChildAt(filhos - 2);
        View check = quadro.getChildAt(filhos - 3);
        check.setVisibility(e.visto ? View.VISIBLE : View.GONE);
        agora.setVisibility(atual ? View.VISIBLE : View.GONE);
        boolean comBarra = !e.visto && e.pct > 0;
        barra.setVisibility(comBarra ? View.VISIBLE : View.GONE);
        if (comBarra) {
            LinearLayout b = (LinearLayout) barra;
            ((LinearLayout.LayoutParams) b.getChildAt(0).getLayoutParams()).weight = Math.max(2, e.pct);
            ((LinearLayout.LayoutParams) b.getChildAt(1).getLayoutParams()).weight = 100 - Math.max(2, e.pct);
            b.requestLayout();
        }
        TextView nome = (TextView) card.getChildAt(1);
        nome.setTextColor(e.visto ? Color.parseColor("#BFFFFFFF") : Color.WHITE);
        ((TextView) card.getChildAt(2)).setText(EpisodiosDados.info(e, atual, posAtual));
    }

    private static boolean mesmosEpisodios(EpisodiosDados a, EpisodiosDados b) {
        if (a.eps.size() != b.eps.size()) return false;
        for (int i = 0; i < a.eps.size(); i++) if (a.eps.get(i).numero != b.eps.get(i).numero) return false;
        return true;
    }

    private void mostrarAviso(String texto) {
        aviso.setText(texto);
        aviso.setVisibility(View.VISIBLE);
        linha.setVisibility(View.INVISIBLE);
    }

    // ── Imagens: só as perto do foco (temporada de anime tem 100+), com cache entre aberturas ──

    private void carregarImagensPerto(int foco) {
        int de = Math.max(0, foco - 5), ate = Math.min(cards.size() - 1, foco + 8);
        for (int i = de; i <= ate; i++) {
            View c = cards.get(i);
            EpisodiosDados.Ep e = (EpisodiosDados.Ep) c.getTag();
            ImageView img = (ImageView) ((FrameLayout) ((LinearLayout) c).getChildAt(0)).getChildAt(0);
            carregarImagem(img, e.imagem);
        }
    }

    private void carregarImagensVisiveis() {
        if (cards.isEmpty()) return;
        int passo = dp(larguraDoCard() + 10);
        int meio = (linha.getScrollX() + linha.getWidth() / 2) / Math.max(1, passo);
        carregarImagensPerto(Math.max(0, Math.min(cards.size() - 1, meio)));
    }

    private static void carregarImagem(final ImageView iv, final String url) {
        if (url == null || url.equals(iv.getTag())) return;
        iv.setTag(url);
        Bitmap b = IMAGENS.get(url);
        if (b != null) { iv.setImageBitmap(b); return; }
        BAIXAR.execute(() -> {
            Bitmap bm = null;
            try {
                okhttp3.Request req = new okhttp3.Request.Builder().url(url).header("User-Agent", "WatchMov-Android").build();
                try (okhttp3.Response r = cliente().newCall(req).execute()) {
                    if (r.isSuccessful() && r.body() != null) bm = BitmapFactory.decodeStream(r.body().byteStream());
                }
            } catch (Exception ex) {
                android.util.Log.i("WatchMov", "episódios: imagem " + url + ": " + ex);
            }
            if (bm == null) return;
            IMAGENS.put(url, bm);
            final Bitmap pronto = bm;
            iv.post(() -> { if (url.equals(iv.getTag())) iv.setImageBitmap(pronto); });
        });
    }

    private static synchronized okhttp3.OkHttpClient cliente() {
        if (http == null) {
            http = new okhttp3.OkHttpClient.Builder().dns(AppDns.get())
                .connectTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(8, java.util.concurrent.TimeUnit.SECONDS).build();
        }
        return http;
    }

    // ── Montagem (1 vez) ──

    private void montar() {
        // Foco preso no painel (como no ⚙): a busca do Android achava o play/vídeo atrás. ↓ do topo vai pro episódio
        // que estava com o foco (não pro mais perto na geometria) e ↑ dos episódios vai pra temporada aberta.
        fundo = new FrameLayout(act) {
            @Override public View focusSearch(View focado, int direcao) {
                boolean doTopo = focado == fecharTv || pilulas.contains(focado);
                if (direcao == View.FOCUS_DOWN && doTopo && !cards.isEmpty() && linha.getVisibility() == View.VISIBLE)
                    return cards.get(Math.max(0, Math.min(cards.size() - 1, ultimoFoco)));
                if (direcao == View.FOCUS_UP && cards.contains(focado)) {
                    for (View p : pilulas) if (p.isSelected()) return p;
                    return fecharTv;
                }
                View v = FocusFinder.getInstance().findNextFocus(this, focado, direcao);
                return v != null ? v : focado;
            }
        };
        fundo.setBackgroundColor(Color.parseColor("#99000000"));
        fundo.setClickable(true);
        fundo.setOnClickListener(v -> fechar(false));   // toque fora do cartão fecha
        fundo.setVisibility(View.GONE);

        LinearLayout c = new LinearLayout(act);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(18), dp(16), dp(18), dp(14));
        c.setClickable(true);                            // toque dentro do cartão não fecha
        GradientDrawable f = new GradientDrawable();
        f.setColor(Color.parseColor("#F215121D")); f.setCornerRadius(dp(16)); f.setStroke(dp(1), Color.parseColor("#26FFFFFF"));
        c.setBackground(f);

        LinearLayout cab = new LinearLayout(act);
        cab.setOrientation(LinearLayout.HORIZONTAL);
        cab.setGravity(Gravity.CENTER_VERTICAL);
        TextView titulo = new TextView(act);
        titulo.setText("Episódios"); titulo.setTextColor(Color.WHITE); titulo.setTextSize(20);
        titulo.setTypeface(Typeface.DEFAULT_BOLD);
        cab.addView(titulo);
        serieTv = new TextView(act);
        serieTv.setTextColor(Color.parseColor("#B3FFFFFF")); serieTv.setTextSize(15);
        serieTv.setSingleLine(true); serieTv.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams lps = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lps.leftMargin = dp(10);
        cab.addView(serieTv, lps);
        pilulasTopo = new LinearLayout(act);
        pilulasTopo.setOrientation(LinearLayout.HORIZONTAL);
        cab.addView(pilulasTopo);
        fecharTv = new TextView(act);
        fecharTv.setText("✕"); fecharTv.setTextColor(Color.WHITE); fecharTv.setTextSize(15);
        fecharTv.setTypeface(Typeface.DEFAULT_BOLD); fecharTv.setGravity(Gravity.CENTER);
        fecharTv.setBackground(fundoDoFechar());
        fecharTv.setFocusable(true); fecharTv.setClickable(true);
        fecharTv.setContentDescription("Fechar");
        fecharTv.setOnClickListener(v -> fechar(false));
        LinearLayout.LayoutParams lpf = new LinearLayout.LayoutParams(dp(34), dp(30));
        lpf.leftMargin = dp(12);
        cab.addView(fecharTv, lpf);
        c.addView(cab);

        pilulasRolagem = new HorizontalScrollView(act);
        pilulasRolagem.setHorizontalScrollBarEnabled(false);
        pilulasLinha = new LinearLayout(act);
        pilulasLinha.setOrientation(LinearLayout.HORIZONTAL);
        pilulasLinha.setPadding(0, dp(3), dp(8), dp(3));
        pilulasRolagem.addView(pilulasLinha);
        LinearLayout.LayoutParams lpr = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpr.topMargin = dp(8); lpr.leftMargin = -dp(8);
        c.addView(pilulasRolagem, lpr);
        pilulasRolagem.setVisibility(View.GONE);

        // Fileira de episódios. A altura não muda entre "Carregando…" e os cards (o cartão não pula).
        FrameLayout area = new FrameLayout(act);
        int alturaCard = dp((larguraDoCard() - 12) * 9 / 16) + dp(84);
        area.setMinimumHeight(alturaCard);
        linha = new HorizontalScrollView(act);
        linha.setHorizontalScrollBarEnabled(false);
        linha.setHorizontalFadingEdgeEnabled(true);
        linha.setFadingEdgeLength(dp(70));
        linha.setClipToPadding(false);
        linha.setPadding(dp(8), dp(8), dp(8), dp(8));   // folga pro card focado crescer (1,07×) sem cortar a borda
        linha.setOnScrollChangeListener((v, x, y, ox, oy) -> carregarImagensVisiveis());
        trilho = new LinearLayout(act);
        trilho.setOrientation(LinearLayout.HORIZONTAL);
        trilho.setClipChildren(false);
        trilho.setClipToPadding(false);
        linha.addView(trilho);
        area.addView(linha, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        aviso = new TextView(act);
        aviso.setTextColor(Color.parseColor("#CCFFFFFF")); aviso.setTextSize(15);
        aviso.setGravity(Gravity.CENTER);
        aviso.setVisibility(View.GONE);
        area.addView(aviso, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, alturaCard, Gravity.CENTER));
        LinearLayout.LayoutParams lpa = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lpa.topMargin = dp(6);
        c.addView(area, lpa);
        cartao = c;

        FrameLayout.LayoutParams lpc = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        lpc.leftMargin = dp(24); lpc.rightMargin = dp(24); lpc.bottomMargin = dp(18);
        fundo.addView(c, lpc);
        raiz.addView(fundo, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private int larguraDoCard() { return tv ? 132 : 124; }

    private TextView etiqueta(String texto, float sp, String cor, int raio) {
        TextView t = new TextView(act);
        t.setText(texto); t.setTextColor(Color.WHITE); t.setTextSize(sp);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setIncludeFontPadding(false);
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(cor)); g.setCornerRadius(dp(raio));
        t.setBackground(g);
        return t;
    }

    // Foco = roxo com borda branca, igual aos blocos do ⚙ (blocoBg) e às pílulas do player.
    private StateListDrawable fundoDoCard() {
        GradientDrawable normal = new GradientDrawable();
        normal.setColor(Color.parseColor("#1FFFFFFF")); normal.setCornerRadius(dp(12));
        return comFoco(normal, 12);
    }

    private StateListDrawable fundoDaPilula() {
        GradientDrawable normal = new GradientDrawable();
        normal.setColor(Color.parseColor("#1FFFFFFF")); normal.setCornerRadius(dp(8));
        GradientDrawable aberta = new GradientDrawable();
        aberta.setColor(Color.parseColor("#7C3AED")); aberta.setCornerRadius(dp(8));
        StateListDrawable sl = comFoco(null, 8);
        sl.addState(new int[] { android.R.attr.state_selected }, aberta);
        sl.addState(new int[] {}, normal);
        return sl;
    }

    private StateListDrawable fundoDoFechar() {
        GradientDrawable normal = new GradientDrawable();
        normal.setColor(Color.parseColor("#99000000")); normal.setCornerRadius(dp(8));
        return comFoco(normal, 8);
    }

    private StateListDrawable comFoco(GradientDrawable normal, int raio) {
        GradientDrawable foco = new GradientDrawable();
        foco.setColor(Color.parseColor("#CC7C3AED")); foco.setCornerRadius(dp(raio)); foco.setStroke(3, Color.WHITE);
        StateListDrawable sl = new StateListDrawable();
        sl.addState(new int[] { android.R.attr.state_pressed }, foco);
        sl.addState(new int[] { android.R.attr.state_focused }, foco);
        if (normal != null) sl.addState(new int[] {}, normal);
        return sl;
    }

    private int dp(float v) { return Math.round(v * act.getResources().getDisplayMetrics().density); }
}
