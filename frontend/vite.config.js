import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Respeta el puerto asignado dinámicamente (autoPort) en vez del 5173
    // fijo, para no chocar con el servidor de otra sesión en la misma máquina.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
  },
})
