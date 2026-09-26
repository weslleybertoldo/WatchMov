package com.weslley.watchmov;

import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import java.util.function.Supplier;

/**
 * Setinha do ▣ Servidor na TV (26/09/2026, pedido dele): a página do servidor é um iframe de outro site e não
 * recebe as setas nem o OK do controle. Com a setinha ligada, as setas movem um ponteiro desenhado por cima de
 * tudo e o OK vira um TOQUE de verdade naquele ponto (o WebView entrega ao iframe como um dedo na tela).
 * Quem liga é o web (tvNav.ts: seta ↓ no último botão, o Ligar). Subir acima da linha dele desliga e o foco volta
 * pro botão; na borda de baixo a página rola, e subir com a página rolada desrola (tudo de uma vez) antes de sair.
 * Parada por 10 s ela some (não fica em cima do filme); o próximo toque só a traz de volta, no mesmo lugar.
 * Voltar e as outras teclas passam direto (o app trata como hoje).
 */
final class TvCursor {
    private TvCursor() {}

    interface Saida { void saiu(String motivo); }

    static final int SOBE = 0, ROLA_CIMA = 1, SAI = 2;
    static final int MOSTRA = 0, TOCA = 1, ANDA = 2, NADA = 3;
    static final long SOME_MS = 10_000;
    /** A TV corta um pouco de cada borda da imagem (overscan): o app (WebView) e a setinha ficam dentro desta margem. */
    static final float MARGEM_SEGURA = 0.025f;

    /** Passo em dp: devagar no toque, acelera segurando (o controle repete a tecla ~20× por segundo). */
    static float passoDp(int repeticao) { return Math.min(12f + 3f * repeticao, 48f); }

    /** Subindo: anda; passou da linha de saída → desrola a página se ela foi rolada, senão sai. */
    static int aoSubir(float yNovo, float linhaSaida, int rolado) {
        if (yNovo >= linhaSaida) return SOBE;
        return rolado > 0 ? ROLA_CIMA : SAI;
    }

    /** Seta ou OK apertado: escondida, o toque só traz a setinha de volta (não anda nem clica no escuro). */
    static int aoApertar(boolean escondida, boolean ok, int repeticao) {
        if (escondida) return MOSTRA;
        if (ok) return repeticao == 0 ? TOCA : NADA;
        return ANDA;
    }

    private static final float MARGEM_BAIXO_DP = 12f;

    /**
     * Onde a ponta da setinha anda, em px da janela {esq, topo, dir, baixo}: a tela menos a margem segura; embaixo,
     * mais 12 dp pra ela não sumir na borda (segurando ↓ ela parava colada no fim da tela, que a TV corta).
     */
    static float[] area(float w, float h, float d) {
        float mx = w * MARGEM_SEGURA, my = h * MARGEM_SEGURA;
        return new float[]{ mx, my, w - mx - 1f, h - my - MARGEM_BAIXO_DP * d };
    }

    private static Ponteiro ponteiro;
    private static float x, y, linha;    // px na janela (mesmo espaço da decor view)
    private static int rolado;            // rolagens pra baixo ainda não desfeitas
    private static Saida saida;
    private static Supplier<View> alvo;   // quem recebe o toque: o WebView ou a tela cheia do player da página
    private static final Runnable SOME = () -> { if (ponteiro != null) ponteiro.setVisibility(View.INVISIBLE); };

    static void aoSair(Saida s) { saida = s; }
    static void alvo(Supplier<View> a) { alvo = a; }
    static boolean ativa() { return ponteiro != null; }

    /** Liga (ou reposiciona) a setinha. Coordenadas em px da janela. Só na thread da UI. */
    static void ligar(Activity a, float xPx, float yPx, float linhaPx) {
        ViewGroup decor = (ViewGroup) a.getWindow().getDecorView();
        if (ponteiro == null) {
            ponteiro = new Ponteiro(a);
            decor.addView(ponteiro, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        x = xPx; y = yPx; linha = linhaPx; rolado = 0;
        ponteiro.invalidate();
        acordar();
        pairar();
    }

    /** Mostra a setinha (se tinha sumido) e recomeça a contar os 10 s parada. */
    private static void acordar() {
        ponteiro.setVisibility(View.VISIBLE);
        ponteiro.removeCallbacks(SOME);
        ponteiro.postDelayed(SOME, SOME_MS);
    }

    /** Desliga. motivo != null → avisa o web (o foco volta pro botão de onde a setinha saiu). */
    static void desligar(String motivo) {
        if (ponteiro == null) return;
        ponteiro.removeCallbacks(SOME);
        ViewGroup pai = (ViewGroup) ponteiro.getParent();
        if (pai != null) pai.removeView(ponteiro);
        ponteiro = null;
        if (motivo != null && saida != null) saida.saiu(motivo);
    }

    /** A tela cheia do player da página entrou por cima: a setinha continua na frente. */
    static void paraFrente() { if (ponteiro != null) ponteiro.bringToFront(); }

    /** Setas e OK enquanto a setinha está ligada. true = a tecla foi usada aqui (não chega no WebView). */
    static boolean onKey(KeyEvent e) {
        if (ponteiro == null) return false;
        int k = e.getKeyCode();
        boolean seta = k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN
            || k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT;
        boolean ok = k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER
            || k == KeyEvent.KEYCODE_NUMPAD_ENTER || k == KeyEvent.KEYCODE_BUTTON_A;
        if (!seta && !ok) return false;
        if (e.getAction() != KeyEvent.ACTION_DOWN) return true;   // o soltar da tecla também é da setinha
        int efeito = aoApertar(ponteiro.getVisibility() != View.VISIBLE, ok, e.getRepeatCount());
        acordar();
        if (efeito == TOCA) tocar();
        if (efeito != ANDA) return true;
        float d = ponteiro.getResources().getDisplayMetrics().density;
        float p = passoDp(e.getRepeatCount()) * d;
        float[] a = area(ponteiro.getWidth(), ponteiro.getHeight(), d);
        if (k == KeyEvent.KEYCODE_DPAD_LEFT) x = Math.max(a[0], x - p);
        else if (k == KeyEvent.KEYCODE_DPAD_RIGHT) x = Math.min(a[2], x + p);
        else if (k == KeyEvent.KEYCODE_DPAD_DOWN) {
            if (y + p > a[3]) { y = a[3]; rolar(-1f); rolado++; } else y += p;
        } else {
            int acao = aoSubir(y - p, linha, rolado);
            if (acao == SAI) { desligar("subiu"); return true; }
            // Desrola tudo de uma vez: numa página que não rola (o player) a borda de baixo também conta, e desrolar
            // um dente por toque deixaria a setinha presa na linha — assim é no máximo 1 toque a mais pra sair.
            if (acao == ROLA_CIMA) { rolar(rolado); rolado = 0; } else y -= p;
        }
        ponteiro.invalidate();
        pairar();
        return true;
    }

    // ---- eventos injetados no WebView (ou na tela cheia do player da página) ----

    private static View alvoAtual() { return alvo != null ? alvo.get() : null; }

    /** Toque (dedo desce e sobe) no ponto da setinha: o iframe recebe como um clique de verdade. */
    private static void tocar() {
        final View v = alvoAtual();
        if (v == null) return;
        final float[] l = local(v);
        final long t0 = SystemClock.uptimeMillis();
        MotionEvent desce = MotionEvent.obtain(t0, t0, MotionEvent.ACTION_DOWN, l[0], l[1], 0);
        desce.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        v.dispatchTouchEvent(desce);
        desce.recycle();
        v.postDelayed(() -> {
            MotionEvent sobe = MotionEvent.obtain(t0, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, l[0], l[1], 0);
            sobe.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            v.dispatchTouchEvent(sobe);
            sobe.recycle();
        }, 60);
    }

    /** Mouse passando por cima: página que mostra os controles no movimento do mouse (JW) acorda. */
    private static void pairar() { ponteiroEvento(MotionEvent.ACTION_HOVER_MOVE, 0f); }

    /** Rodinha do mouse no ponto da setinha: rola o que estiver embaixo dela (o iframe). +1 sobe, -1 desce. */
    private static void rolar(float dentes) { ponteiroEvento(MotionEvent.ACTION_SCROLL, dentes * 3f); }

    private static void ponteiroEvento(int acao, float vscroll) {
        View v = alvoAtual();
        if (v == null) return;
        float[] l = local(v);
        MotionEvent.PointerProperties pp = new MotionEvent.PointerProperties();
        pp.id = 0;
        pp.toolType = MotionEvent.TOOL_TYPE_MOUSE;
        MotionEvent.PointerCoords pc = new MotionEvent.PointerCoords();
        pc.x = l[0];
        pc.y = l[1];
        pc.setAxisValue(MotionEvent.AXIS_VSCROLL, vscroll);
        long t = SystemClock.uptimeMillis();
        MotionEvent ev = MotionEvent.obtain(t, t, acao, 1, new MotionEvent.PointerProperties[]{pp},
            new MotionEvent.PointerCoords[]{pc}, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0);
        v.dispatchGenericMotionEvent(ev);
        ev.recycle();
    }

    /** Ponto da setinha nas coordenadas da view alvo. */
    private static float[] local(View v) {
        int[] loc = new int[2];
        v.getLocationInWindow(loc);
        return new float[]{ x - loc[0], y - loc[1] };
    }

    /** A setinha desenhada: seta clássica de mouse, branca com borda preta e sombra. Não pega toque nenhum. */
    private static final class Ponteiro extends View {
        private final Paint corpo = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint borda = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint sombra = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path seta = new Path();
        private final float d;

        Ponteiro(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
            setClickable(false);
            setFocusable(false);
            setWillNotDraw(false);
            corpo.setColor(0xFFFFFFFF);
            corpo.setStyle(Paint.Style.FILL);
            sombra.setColor(0x66000000);
            sombra.setStyle(Paint.Style.FILL);
            borda.setColor(0xFF000000);
            borda.setStyle(Paint.Style.STROKE);
            borda.setStrokeWidth(1.5f * d);
            borda.setStrokeJoin(Paint.Join.ROUND);
            float s = 1.2f * d;   // ~29 dp de altura: dá pra ver do sofá
            seta.moveTo(0, 0);
            seta.lineTo(0, 21 * s);
            seta.lineTo(5 * s, 16 * s);
            seta.lineTo(9 * s, 24 * s);
            seta.lineTo(12 * s, 22.5f * s);
            seta.lineTo(8.5f * s, 15 * s);
            seta.lineTo(15 * s, 15 * s);
            seta.close();
        }

        @Override protected void onDraw(Canvas c) {
            c.save();
            c.translate(x + 1.5f * d, y + 2f * d);
            c.drawPath(seta, sombra);
            c.restore();
            c.save();
            c.translate(x, y);
            c.drawPath(seta, corpo);
            c.drawPath(seta, borda);
            c.restore();
        }

        @Override public boolean dispatchTouchEvent(MotionEvent e) { return false; }
        @Override public boolean dispatchGenericMotionEvent(MotionEvent e) { return false; }
    }
}
