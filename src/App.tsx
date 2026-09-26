import { lazy, Suspense, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LoginScreen } from "@/components/LoginScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TvApproveDialog } from "@/components/TvApproveDialog";
import { isTv, tvDeviceInfo } from "@/lib/device";
import { registerTvDevice, TvPairError } from "@/lib/tvPair";
import { Loader2 } from "lucide-react";

const Index = lazy(() => import("./pages/Index.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

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
  const token = session?.access_token;
  useEffect(() => {
    if (!isTv() || !token) return;
    registerTvDevice(token, tvDeviceInfo()).catch((e) => {
      if (e instanceof TvPairError && e.code === "session_gone") void signOutRef.current();
    });
  }, [token]);

  if (loading) return <Spinner />;
  if (!user) return <LoginScreen />;

  return (
    <BrowserRouter>
      <TvApproveDialog />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AuthGate />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
