import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "graph-vendor": ["react-force-graph-2d", "react-force-graph-3d", "three"]
        }
      }
    }
  },
  server: {
    port: 3001,
    strictPort: true
  },
  preview: {
    port: 3002,
    strictPort: true
  }
});
