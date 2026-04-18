import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Split vendor bundles so they cache across deploys.
    // App code changes often; Firebase/Privy/viem change rarely.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'vendor-privy': ['@privy-io/react-auth'],
          'vendor-icons': ['lucide-react'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
    // Bump the warning threshold so legit vendor chunks don't spam warnings.
    chunkSizeWarningLimit: 800,
  },
  define: {
    global: 'globalThis',
  },
});
