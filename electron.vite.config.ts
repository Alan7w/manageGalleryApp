import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    // Dev server only (the installed app loads files, no port). Kept off Vite's
    // default 5173 so it doesn't collide with other projects.
    server: { port: 5319 },
    resolve: {
      alias: { ...shared, '@': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()]
  }
})
