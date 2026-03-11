import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
  },
})
