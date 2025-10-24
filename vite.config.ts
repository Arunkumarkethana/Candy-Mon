import { defineConfig } from 'vite'

// Split large dependencies to reduce bundle size warnings
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/phaser/')) return 'phaser'
            return 'vendor'
          }
        }
      }
    },
    chunkSizeWarningLimit: 1500
  },
  server: {
    host: true
  }
})
