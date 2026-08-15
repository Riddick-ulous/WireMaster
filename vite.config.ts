import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust continuously creates/replaces executables below src-tauri/target.
      // Watching them on Windows can fail with EBUSY while Cargo has a file locked.
      ignored: ['**/src-tauri/**'],
    },
  },
});
