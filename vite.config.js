import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  build: {
    rollupOptions: {
      output: {
        // PDF-Bibliotheken explizit ins Hauptbundle, damit kein dynamisches Nachladen passiert.
        // Damit umgehen wir potentielle MIME-Type-Probleme bei nachgeladenen Modulen.
        manualChunks: undefined,
      },
    },
  },
});
