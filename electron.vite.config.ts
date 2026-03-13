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
        __WEB_URL__: JSON.stringify(env.VITE_WEB_URL || ''),
        __API_URL__: JSON.stringify(env.VITE_API_URL || ''),
      },
    },
    preload: {},
    renderer: {
      root: 'src/renderer',
      plugins: [react(), tailwindcss()],
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
      },
    },
  }
})
