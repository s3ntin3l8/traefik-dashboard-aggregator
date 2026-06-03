import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { MobileProvider } from "./lib/mobile";
import "./styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileProvider>
      <App />
    </MobileProvider>
  </React.StrictMode>,
);
