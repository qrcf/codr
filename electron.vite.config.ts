import { readFileSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    main: {
      define: {
        __WEB_URL__: JSON.stringify(''),  // Always load bundled renderer locally
        __API_URL__: JSON.stringify(env.VITE_API_URL || ''),
        __RELAY_URL__: JSON.stringify(env.VITE_RELAY_URL || ''),
      },
    },
    preload: {},
    renderer: {
      root: 'src/renderer',
      plugins: [react(), tailwindcss()],
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
      },
      server: {
        port: 5173
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('react-syntax-highlighter') || id.includes('node_modules/refractor') || id.includes('node_modules/prismjs')) {
                return 'syntax-highlight'
              }
              if (
                id.includes('react-markdown') ||
                id.includes('remark-gfm') ||
                id.includes('node_modules/micromark') ||
                id.includes('node_modules/rehype') ||
                id.includes('node_modules/remark') ||
                id.includes('node_modules/unified') ||
                id.includes('node_modules/hast') ||
                id.includes('node_modules/mdast') ||
                id.includes('node_modules/vfile') ||
                id.includes('node_modules/unist')
              ) {
                return 'markdown'
              }
            },
          },
        },
      },
    },
  }
})
