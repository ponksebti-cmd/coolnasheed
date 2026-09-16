import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("CoolNasheed needs a #root element to render into.");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary label="the app" bare>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
