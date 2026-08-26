import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyRenderColorVariables } from "@bylina/render";
import { App } from "./App.js";
import "../../../packages/ui/src/battle.css";
import "../../../packages/ui/src/campaign.css";
import "./styles.css";

// CSS и PixiJS получают цветовые значения из одного справочника render.
applyRenderColorVariables();

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
