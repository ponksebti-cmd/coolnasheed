import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * There is no server to proxy to, and that is the point.
 *
 * The browser talks to Supabase directly: PostgREST for reads and toggles, Storage for
 * audio and artwork, Edge Functions for the six things that need a server, Auth for
 * credentials. Every one of those is an absolute HTTPS URL to your project, so Vite
 * only has to serve the app — no `/api` rewrite, no second process, no CORS puzzle in
 * development that disappears in production.
 *
 * The sandbox preview proxies this dev server under https://{port}-{sandbox}.e2b.app,
 * so we bind 0.0.0.0 and accept any host. Supabase's own CORS allows any origin for
 * the anon key, which is what makes that work without configuration.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    hmr: {
      clientPort: 443,
      protocol: "wss",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // the Supabase client and the React runtime are the two heavy, rarely-changing
        // pieces; splitting them keeps a first paint small and a redeploy cheap
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
