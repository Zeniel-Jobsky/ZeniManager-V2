import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { bootstrapStoredAppSettings } from "./lib/supabase";

async function bootstrapApp() {
  await bootstrapStoredAppSettings();

  createRoot(document.getElementById("root")!).render(
    <App />
  );
}

void bootstrapApp();
