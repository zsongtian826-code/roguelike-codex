import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/roguelike-codex/',
  plugins: [react()],
})
