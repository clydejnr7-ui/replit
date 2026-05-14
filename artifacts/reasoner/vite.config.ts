import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const port = Number(process.env.PORT ?? "5173");
const basePath = process.env.BASE_PATH ?? "/";

const isReplit = process.env.REPL_ID !== undefined;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...(isReplit && process.env.NODE_ENV !== "production"
      ? [
          (await import("@replit/vite-plugin-runtime-error-modal").catch(() => ({ default: null }))).default?.(),
          (await import("@replit/vite-plugin-cartographer").catch(() => ({ cartographer: null }))).cartographer?.({
            root: path.resolve(import.meta.dirname, ".."),
          }),
          (await import("@replit/vite-plugin-dev-banner").catch(() => ({ devBanner: null }))).devBanner?.(),
        ].filter(Boolean)
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: false,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
    // In local dev (no Replit proxy), forward /api to the API server
    ...(!isReplit && {
      proxy: {
        "/api": {
          target: `http://localhost:${process.env.API_PORT ?? "5000"}`,
          changeOrigin: true,
        },
      },
    }),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
