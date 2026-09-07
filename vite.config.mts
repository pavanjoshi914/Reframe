import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          delete process.env.ELECTRON_RUN_AS_NODE;
          console.log('[vite-plugin-electron] launching electron…');
          startup(['.', '--no-sandbox']);
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'uiohook-napi', 'electron-updater']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'uiohook-napi', 'electron-updater']
            }
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared')
    }
  },
  build: {
    rollupOptions: {
      input: {
        hud: path.resolve(__dirname, 'hud.html'),
        picker: path.resolve(__dirname, 'picker.html'),
        editor: path.resolve(__dirname, 'editor.html'),
        region: path.resolve(__dirname, 'region.html'),
        update: path.resolve(__dirname, 'update.html')
      }
    }
  },
  server: {
    host: '127.0.0.1',
    // Not 5173. That is Vite's default, so every other project on the machine
    // claims it too — and with strictPort we do not fall back, we fail. Worse,
    // when someone else got there first the Electron shell happily loaded THEIR
    // page: the editor window once came up showing an unrelated portfolio site.
    // Override with REFRAME_DEV_PORT if 5273 is taken as well.
    port: Number(process.env.REFRAME_DEV_PORT ?? 5273),
    strictPort: true
  }
});
