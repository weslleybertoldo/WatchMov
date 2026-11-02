import { lazy, Suspense, useEffect, useRef } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LoginScreen } from "@/components/LoginScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isTv, tvDeviceInfo } from "@/lib/device";
import { registerTvDevice, TvPairError } from "@/lib/tvPair";
import { depoisDeAssentar } from "@/lib/ocioso";
import { Loader2 } from "lucide-react";

// W1 do raio-x (02/11/2026): a tela principal começa a carregar JÁ, junto com o login (antes só começava depois do 1º
// desenho, com o login pronto). Fora do JS da abertura: o react-query (nenhuma tela usava), os avisos do shadcn (os
// toasts são todos do sonner), o tooltip (nenhum em uso) e o roteador (só existem "/" e a página de não encontrado).
const carregarIndex = () => import("./pages/Index.tsx");
const indexCarregando = carregarIndex();
const Index = lazy(() => indexCarregando.catch(carregarIndex));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
// Celular aprovando o login de uma TV: o diálogo chega depois do 1º desenho (na TV ele nem aparece).
const TvApproveDialog = lazy(() => import("@/components/TvApproveDialog").then(m => ({ default: m.TvApproveDialog })));

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function AuthGate() {
  const { user, session, loading, signOut } = useAuth();
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  // TV logada se anota na lista "TVs conectadas" do celular (e a cada renovação do login
  // atualiza "usada por último"). Falhou = tenta na próxima; não atrapalha o app.
  // Removida no celular enquanto estava desligada: ao abrir, sai e volta pra tela do código.
  // W1 do raio-x: espera a tela assentar (não disputa a abertura com a TMDB e o desenho das fileiras).
  const token = session?.access_token;
  useEffect(() => {
    if (!isTv() || !token) return;
    return depoisDeAssentar(() => {
      registerTvDevice(token, tvDeviceInfo()).catch((e) => {
        if (e instanceof TvPairError && e.code === "session_gone") void signOutRef.current();
      });
    });
  }, [token]);

  if (loading) return <Spinner />;
  if (!user) return <LoginScreen />;

  return (
    <>
      <Suspense fallback={null}>
        <TvApproveDialog />
      </Suspense>
      <Suspense fallback={<Spinner />}>
        {window.location.pathname === "/" ? <Index /> : <NotFound />}
      </Suspense>
    </>
  );
}

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <Sonner />
      <AuthGate />
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
