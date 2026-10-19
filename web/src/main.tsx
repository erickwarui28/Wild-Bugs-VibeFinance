import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import { StoreProvider } from "./store";
import { AccountProvider } from "./account";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("root missing");
createRoot(root).render(
  <StrictMode>
    <AccountProvider><StoreProvider>
      <App />
      <Toaster theme="dark" toastOptions={{ style: { background: "var(--surface)", color: "var(--text)", borderColor: "var(--border)" } }} />
    </StoreProvider></AccountProvider>
  </StrictMode>,
);
