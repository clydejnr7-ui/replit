import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// When VITE_API_URL is set (e.g. in production or when running frontend
// and backend on separate origins), all API calls are prefixed with it.
// Leave unset for local dev (the Vite proxy or Replit's shared proxy handles routing).
const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
