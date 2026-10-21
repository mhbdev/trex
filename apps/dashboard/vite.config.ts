import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The operator UI must never load backend .env files into the Vite process.
  envDir: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:4173", changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
