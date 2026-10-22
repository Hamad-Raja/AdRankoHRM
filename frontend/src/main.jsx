import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import App from "./App.jsx";
import { ThemeProvider } from "@/context/theme-provider";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("OfficeHR root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);