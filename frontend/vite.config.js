import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = Number(process.env.VITE_DEV_PORT || 5173);
const API_PROXY = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: true,
  },

  '/uploads': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: true,
  },
};

function informeBundle() {
  return {
    name: 'informe-bundle',

    generateBundle(_opciones, bundle) {
      const chunks = Object.values(bundle)
        .filter((item) => item.type === 'chunk')
        .map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.keys(chunk.modules),
        }));

      this.emitFile({
        type: 'asset',
        fileName: 'bundle-analysis.json',
        source: JSON.stringify({ chunks }, null, 2),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), informeBundle()],

  build: {
    manifest: true,
  },

  server: {
    port: DEV_PORT,
    host: true,
    strictPort: true,
    hmr: { overlay: true },
    ws: { clientPort: DEV_PORT },

    proxy: API_PROXY,
  },

  // `vite preview` sirve exactamente `dist/`. El proxy se declara también
  // aquí para que la prueba HTTPS no dependa de la herencia interna de Vite.
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: API_PROXY,
  },
});
