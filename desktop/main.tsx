import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../src/styles.css";
import { Index } from "../src/routes/index";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Index />
    </StrictMode>,
  );
}
