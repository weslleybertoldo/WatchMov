import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initDevice } from "./lib/device";

// Antes do 1º render: na TV (Fire TV / Android TV) já muda o que aparece na primeira tela.
initDevice().then(() => createRoot(document.getElementById("root")!).render(<App />));
