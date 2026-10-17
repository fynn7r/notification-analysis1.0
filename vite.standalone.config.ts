import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const standalonePages: Plugin = {
  name: 'standalone-pages',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.method === 'GET' && request.headers.accept?.includes('text/html') && !request.url?.startsWith('/api/')) {
        request.url = '/standalone.html';
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.method === 'GET' && request.headers.accept?.includes('text/html') && !request.url?.startsWith('/api/')) {
        request.url = '/standalone.html';
      }
      next();
    });
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  const proxy = { '/api': { target: `http://127.0.0.1:${env.API_PORT || 3001}`, changeOrigin: true } };
  return {
    plugins: [standalonePages, react(), tailwindcss()],
    define: { 'import.meta.env.VITE_STANDALONE': 'true' },
    resolve: { alias: [
      { find: /^@lark-apaas\/client-toolkit-lite$/, replacement: path.resolve('src/lib/standalone-runtime.tsx') },
      { find: '@', replacement: path.resolve('src') },
      { find: '@shared', replacement: path.resolve('shared') },
    ] },
    server: { host: '127.0.0.1', port: 8001, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 8001, strictPort: true, proxy },
    build: { outDir: 'dist-standalone', rollupOptions: { input: path.resolve('standalone.html') } },
  };
});
