import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../skills/code-review-feedback/app/web',
    emptyOutDir: true,
  },
});
