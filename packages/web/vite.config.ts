import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    port: 5174
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, '../../src/renderer/src/components'),
      '@utils': path.resolve(__dirname, '../../src/renderer/src/utils'),
      '@/types': path.resolve(__dirname, '../../src/renderer/src/types'),
      '@app': path.resolve(__dirname, '../../src/renderer/src/App'),
      '@styles': path.resolve(__dirname, '../../src/renderer/src'),
      '@codr-context': path.resolve(__dirname, '../../src/renderer/src/CodrContext'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ['motion', 'motion/react'],
          clerk: ['@clerk/clerk-react'],
          markdown: ['react-markdown', 'remark-gfm'],
          'syntax-highlight': ['react-syntax-highlighter'],
        },
      },
    },
  },
})
