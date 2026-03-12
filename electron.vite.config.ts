import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    main: {
      define: {
        __WEB_URL__: JSON.stringify(env.VITE_WEB_URL || ''),
      },
    },
    preload: {},
    renderer: {
      root: 'src/renderer',
      plugins: [react()],
    },
  }
})
