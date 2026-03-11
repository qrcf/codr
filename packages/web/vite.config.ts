import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, '../../src/renderer/src/components'),
      '@utils': path.resolve(__dirname, '../../src/renderer/src/utils'),
      '@/types': path.resolve(__dirname, '../../src/renderer/src/types'),
      '@app': path.resolve(__dirname, '../../src/renderer/src/App'),
      '@styles': path.resolve(__dirname, '../../src/renderer/src'),
    },
  },
  build: {
    outDir: 'dist',
  },
})
