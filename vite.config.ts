import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0", // Escucha en todas las interfaces de red
    port: 3000,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"], // Acceso remoto vía túnel de Cloudflare
  },
  preview: {
    host: "0.0.0.0", // Para el preview también
    port: 3000,
    strictPort: true,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
